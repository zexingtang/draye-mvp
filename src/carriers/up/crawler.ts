/**
 * UP (Union Pacific) 爬虫 —— 登录 MyUPRR 的 Track Shipments，查集装箱状态。
 *
 * 跟 BNSF 的关键区别，都是踩过坑/逆向出来的，别删：
 * 1. **UP 必须登录**（BNSF 是免登录）。登录走 SiteMinder SSO，两步：
 *    输 UserID(`#userId`) → 点 CONTINUE → 等密码框出现(SPA，URL 不变) → 输密码 → 点 SIGN IN。
 *    账号密码从 config 读（环境变量），绝不硬编码。
 * 2. **不抓 DOM，直接拦 JSON 接口**。Track Shipments 页填箱号(textarea，最多 1000 个) → SUBMIT，
 *    页面会 POST `/services/private-shipment-visibility/build-shipment-view/2.0`，响应是干净的
 *    JSON（shipmentNodes[].data）。我们拦这个响应来解析，比抓表格 DOM 稳得多。旧仓库那套 2400 行
 *    的 DOM/正文文本抓取就是因为没走接口，一直不稳——这版彻底换掉。
 * 3. **箱号匹配要去掉校验位**。查询用 11 位标准箱号，接口返回的 equipmentId 是 10 位（去掉最后一位
 *    校验位，如 NYKU3685258 → NYKU368525）。匹配时两边都归一化（去校验位 + 去前导零）。
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { CarrierCrawler, ContainerResult, CrawlProgressCallback } from '../base.js';
import { CrawlerError } from '../base.js';
import { getUPConfig, getBatchSize, getTimeouts } from './config.js';
import { randomDelay } from '../../lib/delays.js';
import { getRandomUserAgent } from '../../lib/human-behavior.js';

const NOT_FOUND_ERROR = 'Container not found in results';
const BUILD_VIEW_URL = 'build-shipment-view';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 归一化成匹配键：4 字母 + 数字，去掉校验位（11 位标准箱号取前 6 位数字）+ 去前导零。
 * 查询箱号和接口返回的 equipmentId 都用它归一化，好把结果对回原始查询箱号。
 */
function matchKey(container: string): string {
  const c = container.toUpperCase().replace(/\s+/g, '');
  const full = c.match(/^([A-Z]{4})(\d{7})$/); // 标准 11 位：4 字母 + 7 数字（末位是校验位）
  if (full) return full[1] + full[2].slice(0, 6).replace(/^0+/, '');
  const any = c.match(/^([A-Z]{4})(\d+)$/); // 已经是 10 位设备号，或别的位数
  if (any) return any[1] + any[2].replace(/^0+/, '');
  return c;
}

/** UP 接口一条 shipmentNode 的 data 字段（只列我们用到的；接口还返回很多别的字段）。 */
interface UPShipmentData {
  equipmentId?: string;
  loadEmptyStatus?: string; // "Load" / "Empty"
  billedStatus?: string; // "Yes" / "No"
  lastAccomplishedEvent?: string; // "Van Notified" 等
  lastAccomplishedCity?: string;
  lastAccomplishedStateAbbreviation?: string;
  lastAccomplishedDate?: string; // ISO
  estimatedTimeOfGroundingDate?: string; // ISO，在途箱子的"预计落地"时间
  destinationCity?: string;
  destinationStateAbbreviation?: string;
  lotAreaSlot?: string; // 场内堆位，如 "S04-C-233"（相当于 BNSF 的 Lot-Row-Spot）
  firstChargeableDay?: string; // "2026-08-21"，相当于 LFD（开始计费日）
  chassisId?: string;
  pickupNumber?: string;
  equipmentType?: string; // "Container"
}

/** "Global 4" + "IL" -> "Global 4, IL"；缺一个就返回有的那个；都没有返回 null。 */
function joinCityState(city?: string | null, state?: string | null): string | null {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (c && s) return `${c}, ${s}`;
  return c || s || null;
}

/** ISO 时间戳 -> ["MM/DD/YY", "HHMM"]；跟 BNSF 的 eta_date/eta_time 格式对齐，好共用前端展示。 */
function splitDateTime(iso?: string | null): [string | null, string | null] {
  if (!iso) return [null, null];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [null, null];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return [`${mm}/${dd}/${yy}`, `${hh}${mi}`];
}

export class UPCrawler implements CarrierCrawler {
  private config = getUPConfig();
  private batchSize = getBatchSize();
  private timeouts = getTimeouts();

  async crawl(containerList: string[], onProgress?: CrawlProgressCallback): Promise<ContainerResult[]> {
    if (containerList.length === 0) throw new Error('Container list cannot be empty');

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
      });
      context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
      });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        (window as unknown as { chrome: { runtime: object } }).chrome = { runtime: {} };
      });
      const page = await context.newPage();
      page.setDefaultTimeout(this.timeouts.navigationTimeout);

      await this.login(page);

      const batches = chunk(containerList, this.batchSize);
      const allResults: ContainerResult[] = [];
      for (let i = 0; i < batches.length; i++) {
        if (i > 0) await randomDelay(1500, 3000);
        console.log(`[UP] Batch ${i + 1}/${batches.length}: querying ${batches[i].length} container(s)`);
        const batchResults = await this.queryBatch(page, batches[i]);
        allResults.push(...batchResults);
        if (onProgress) {
          onProgress({
            batchesDone: i + 1,
            totalBatches: batches.length,
            processed: allResults.length,
            total: containerList.length,
            found: allResults.filter((r) => !r.error).length,
            notFound: allResults.filter((r) => r.error === NOT_FOUND_ERROR).length,
            errored: allResults.filter((r) => r.error && r.error !== NOT_FOUND_ERROR).length,
          });
        }
      }
      return allResults;
    } catch (error) {
      const err = error as Error;
      throw new CrawlerError(`UP crawl failed: ${err.message}`, 'CRAWL', undefined, err);
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }

  /** 两步登录：UserID → CONTINUE → 密码 → SIGN IN。登录成功的标志是跳出登录域、进到 c02.my.uprr.com 的 Track Shipments。 */
  private async login(page: Page): Promise<void> {
    console.log('[UP] Logging in...');
    await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: this.timeouts.navigationTimeout });
    await page.waitForLoadState('networkidle', { timeout: this.timeouts.navigationTimeout }).catch(() => {});

    // 步骤1：UserID（"User ID or Email" 是浮动 label 不是 placeholder；输入框 id=userId）
    const userInput = page.locator('#userId, input[type="text"]:not([type="hidden"])').first();
    await userInput.waitFor({ state: 'visible', timeout: this.timeouts.loginTimeout });
    await userInput.fill(this.config.username);
    const continueBtn = page.getByRole('button', { name: /continue|next/i }).first();
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) await continueBtn.click();
    else await page.keyboard.press('Enter');

    // 步骤2：等密码框出现（SPA，URL 不变，靠 DOM 判断）
    await page.waitForFunction(() => !!document.querySelector('input[type="password"]'), { timeout: this.timeouts.loginTimeout });
    const passInput = page.locator('input[type="password"]').first();
    await passInput.fill(this.config.password);
    const signInBtn = page.getByRole('button', { name: /sign in|log ?in|submit/i }).first();
    if (await signInBtn.isVisible({ timeout: 5000 }).catch(() => false)) await signInBtn.click();
    else await page.keyboard.press('Enter');

    // 等登录完成：要么 URL 回到 c02.my.uprr.com 的应用页，要么标题变成 Track Shipments
    await page
      .waitForFunction(
        () => location.hostname.includes('c02.my.uprr.com') && !location.href.includes('/ulp/login'),
        { timeout: this.timeouts.loginTimeout }
      )
      .catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: this.timeouts.navigationTimeout }).catch(() => {});
    await page.waitForTimeout(3000);

    // 校验：还在登录页 = 登录失败（多半是账号密码不对）
    if (page.url().includes('/ulp/login')) {
      const body = (await page.textContent('body').catch(() => '')) || '';
      const incorrect = /incorrect|invalid|not match/i.test(body);
      throw new Error(incorrect ? 'UP 登录失败：账号或密码不正确' : 'UP 登录失败：登录后仍停在登录页');
    }
    console.log('[UP] Login OK:', page.url());
  }

  /** 一批查询：填 textarea → SUBMIT → 拦 build-shipment-view 响应 → 解析。 */
  private async queryBatch(page: Page, containerList: string[]): Promise<ContainerResult[]> {
    // 原始箱号(11位) <-> 匹配键(去校验位) 的映射，用来把接口结果对回原始箱号
    const keyToOriginal = new Map<string, string>();
    for (const original of containerList) keyToOriginal.set(matchKey(original), original);

    try {
      // 多批时搜索面板可能收起了，点右上角 SEARCH 重新打开（首批一般已经开着，找不到按钮也没关系）
      const openSearch = page.getByRole('button', { name: /^search$/i }).first();
      if (await openSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
        await openSearch.click().catch(() => {});
        await page.waitForTimeout(800);
      }

      const box = page.locator('textarea').first();
      await box.waitFor({ state: 'visible', timeout: this.timeouts.searchTimeout });
      await box.click();
      await box.fill(containerList.join('\n'));

      // 先挂上响应拦截，再点 SUBMIT，避免错过
      const respPromise = page.waitForResponse(
        (r) => r.url().includes(BUILD_VIEW_URL) && r.request().method() === 'POST',
        { timeout: this.timeouts.searchTimeout }
      );
      const submitBtn = page.getByRole('button', { name: /^submit$/i }).first();
      if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) await submitBtn.click();
      else await page.keyboard.press('Enter');

      const resp = await respPromise;
      const json = (await resp.json().catch(() => null)) as { shipmentNodes?: Array<{ data?: UPShipmentData }> } | null;
      const nodes = json?.shipmentNodes ?? [];

      const results: ContainerResult[] = [];
      const remaining = new Set(keyToOriginal.keys());
      for (const node of nodes) {
        const data = node.data;
        if (!data?.equipmentId) continue;
        const key = matchKey(data.equipmentId);
        const original = keyToOriginal.get(key);
        if (!original) continue; // 返回了没查过的箱号，忽略
        remaining.delete(key);

        const [etaDate, etaTime] = splitDateTime(data.estimatedTimeOfGroundingDate);
        results.push({
          cntr: original,
          eta_date: etaDate,
          eta_time: etaTime,
          extra: {
            // 对齐 BNSF/前端用的字段 key，让同一套列和状态判定逻辑直接复用
            storage_last_free_day: data.firstChargeableDay ?? null,
            lot_row_spot: data.lotAreaSlot ?? null,
            last_hub: joinCityState(data.lastAccomplishedCity, data.lastAccomplishedStateAbbreviation),
            destination_hub: joinCityState(data.destinationCity, data.destinationStateAbbreviation),
            bill_yn: data.billedStatus ? (/^y/i.test(data.billedStatus) ? 'Y' : 'N') : null,
            chassis_number: data.chassisId ?? null,
            // UP 特有：最近事件（如 "Van Notified"）+ 装/空 + 提货号，塞进 extra 备用
            last_event: data.lastAccomplishedEvent ?? null,
            load_empty: data.loadEmptyStatus ?? null,
            pickup_number: data.pickupNumber ?? null,
          },
        });
      }

      // 没在结果里出现的 = 查无此箱（正常业务情况，可能已不在 UP 系统里）
      for (const key of remaining) {
        results.push({ cntr: keyToOriginal.get(key) || key, eta_date: null, eta_time: null, error: NOT_FOUND_ERROR });
      }
      return results;
    } catch (err) {
      const error = err as Error;
      console.error('[UP] Batch query error:', error.message);
      // 整批失败：每个箱号标真实错误（走数据保留逻辑，不用空值覆盖）
      return containerList.map((cntr) => ({ cntr, eta_date: null, eta_time: null, error: error.message }));
    }
  }
}
