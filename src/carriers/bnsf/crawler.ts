/**
 * BNSF 爬虫 —— 打免登录的移动端查询页面（m.bnsf.com），不需要账号密码。
 *
 * 这是从"登录版桌面页面"整个换过来的新实现，原因：
 * 1. 免登录，彻底不用管账号/密码/SAML 登录流程，工程量和维护成本都小很多
 * 2. 亲测批量查询、字段解析都正常，返回的数据比登录版更干净（ETADate/ETATime 是
 *    分开的隐藏 div，不用自己再拆日期时间字符串）
 *
 * 两个关键点，都是踩过坑才发现的，别删：
 * - 查询时集装箱号要去掉最后一位校验位（11 位号 -> 10 位：4字母+6数字），
 *   BNSF 系统认的是不带校验位的"设备号"，带校验位提交会直接报 "invalid"
 * - 多个箱号之间只能用空格分隔，不能用逗号——这个页面的输入框有自己的前端逻辑，
 *   用逗号分隔会诡异地把逗号翻倍，导致解析出的箱号是错的
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { CarrierCrawler, ContainerResult } from '../base.js';
import { CrawlerError } from '../base.js';
import { getCrawlerOptions, getBatchSize } from './config.js';
import { randomDelay } from '../../lib/delays.js';
import { getRandomUserAgent } from '../../lib/human-behavior.js';

const ENTRY_URL = 'https://m.bnsf.com/bnsf.was6/dillApp/rprt';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 有些字段没值的时候不是空字符串，是"- -"这种占位符——统一转成 null，别把占位符当真实数据展示出去 */
function normalizeEmpty(value: string | null): string | null {
  if (!value) return null;
  const stripped = value.replace(/-/g, '').trim();
  return stripped ? value : null;
}

/**
 * 整批都因为"非查无此箱"的原因失败了——说明是这一批的提交/跳转本身挂了，不是箱号的问题。
 * "查无此箱"不算失败：那是正常业务情况(箱子可能已经不在 BNSF 系统里了)。
 */
function batchFailedEntirely(results: ContainerResult[]): boolean {
  return results.length > 0 && results.every((r) => r.error && r.error !== 'Container not found in results');
}

/**
 * 11 位标准集装箱号（4字母+7数字，含校验位）-> BNSF 查询用的设备号：
 * 1. 去掉最后一位校验位
 * 2. 去掉数字部分的前导零（BNSF 系统按不带前导零的数字匹配）
 * 例：BEAU0274496 -> BEAU27449，BEAU0000095 -> BEAU9
 */
function stripCheckDigit(containerNumber: string): string {
  const clean = containerNumber.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]{4}\d{7}$/.test(clean)) {
    const letters = clean.slice(0, 4);
    const digits = clean.slice(4, -1); // 去掉最后一位校验位，剩 6 位数字
    return letters + String(parseInt(digits, 10)); // parseInt 自动去掉前导零
  }
  return clean;
}

export class BNSFCrawler implements CarrierCrawler {
  private options;
  private batchSize;

  constructor() {
    this.options = getCrawlerOptions();
    this.batchSize = getBatchSize();
  }

  async crawl(containerList: string[]): Promise<ContainerResult[]> {
    if (containerList.length === 0) {
      throw new Error('Container list cannot be empty');
    }

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      context = await browser.newContext({ userAgent: getRandomUserAgent() });
      page = await context.newPage();
      page.setDefaultTimeout(this.options.defaultTimeout || 30000);

      const batches = chunk(containerList, this.batchSize);
      const allResults: ContainerResult[] = [];

      for (let i = 0; i < batches.length; i++) {
        if (i > 0) await randomDelay(1000, 2000);
        console.log(`[BNSF] Batch ${i + 1}/${batches.length}: querying ${batches[i].length} container(s)`);
        let batchResults = await this.queryBatch(page, batches[i]);

        // 整批一个都没查到 = 这一批的提交/跳转本身出问题了(实际发生过：提交之后页面 30 秒
        // 没响应，waitForNavigation 超时)，基本都是临时性的。重试一次，别让一次抖动就把
        // 一整批(最多 50 个)箱号的数据全丢掉。只重试整批失败的情况——个别箱号查不到是
        // 正常业务情况，重试没有意义。
        if (batchFailedEntirely(batchResults)) {
          console.log(`[BNSF] Batch ${i + 1} failed entirely, retrying once`);
          await randomDelay(3000, 5000);
          const retried = await this.queryBatch(page, batches[i]);
          if (!batchFailedEntirely(retried)) batchResults = retried;
        }

        allResults.push(...batchResults);
      }

      return allResults;
    } catch (error) {
      const err = error as Error;
      throw new CrawlerError(`Crawl failed: ${err.message}`, 'CRAWL', undefined, err);
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }

  private async queryBatch(page: Page, containerList: string[]): Promise<ContainerResult[]> {
    const results: ContainerResult[] = [];

    // 原始箱号(带校验位) <-> 查询用箱号(不带校验位) 的映射，查完要用它把结果对回原始箱号
    const queryToOriginal = new Map<string, string>();
    for (const original of containerList) {
      queryToOriginal.set(stripCheckDigit(original), original);
    }
    const queryString = [...queryToOriginal.keys()].join(' '); // 只能用空格，见文件头注释

    try {
      await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: this.options.navigationTimeout });

      const equipmentBox = page.locator('textarea[name="equipment"]');
      await equipmentBox.waitFor({ state: 'visible', timeout: this.options.selectorTimeout });
      await equipmentBox.click();
      await equipmentBox.pressSequentially(queryString, { delay: 10 });

      const actualValue = await equipmentBox.inputValue();
      if (actualValue.trim() !== queryString.trim()) {
        throw new Error(
          `Equipment textarea content mismatch after typing. Intended: "${queryString}" Actual: "${actualValue}"`
        );
      }

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: this.options.navigationTimeout }),
        page.locator('a[href="javascript:formSubmit()"]').click(),
      ]);

      const remaining = new Set(queryToOriginal.keys());
      const blocks = await page.locator('#dllresults').all();

      for (const block of blocks) {
        const unitInit = (await block.locator('[id="UnitInit"]').first().textContent().catch(() => ''))?.trim() || '';
        const unitNumber = (await block.locator('[id="UnitNumber"]').first().textContent().catch(() => ''))?.trim() || '';
        if (!unitInit || !unitNumber) continue;

        // BNSF 返回的 unitNumber 可能带前导零（如 "027449"），而我们的 map 存的是去掉前导零
        // 的版本（"27449"），要对齐。parseInt 自动去掉前导零，非纯数字则原样保留。
        const normalizedUnit = /^\d+$/.test(unitNumber) ? String(parseInt(unitNumber, 10)) : unitNumber;
        const queryKey = `${unitInit}${normalizedUnit}`.toUpperCase();
        const originalContainer = queryToOriginal.get(queryKey);
        if (!originalContainer) continue; // 页面返回了我们没查过的箱号，忽略

        // BNSF 这边有些字段是定长的，用空格补齐（比如 "THENARD   CA"），把内部多余空格也收一下
        const grab = async (id: string) => {
          const text = (await block.locator(`[id="${id}"]`).first().textContent().catch(() => ''))?.trim().replace(/\s+/g, ' ');
          return text || null;
        };

        const etaDate = await grab('ETADate');
        const etaTime = await grab('ETATime');
        const lastFreeDay = await grab('LastFreeDay');

        // 除了 ETA/LFD，这个页面每个箱号还带这些字段，一起抓出来展示在表格上
        const chassisInit = await grab('ChassisInit');
        const chassisNumber = await grab('ChassisNumber');
        const chassis = chassisInit && chassisNumber ? `${chassisInit}${chassisNumber}` : null;
        const lastHub = await grab('LastHub');
        const billYN = await grab('BillYN');
        const lotRowSpot = await grab('Lot-Row-Spot');
        const destinationHub = await grab('DestHub');
        const lockedEtnDateTime = await grab('ETN');
        const unitLength = await grab('UnitLgth');

        results.push({
          cntr: originalContainer,
          eta_date: etaDate,
          eta_time: etaTime,
          extra: {
            storage_last_free_day: lastFreeDay,
            chassis_number: chassis,
            last_hub: lastHub,
            bill_yn: billYN,
            lot_row_spot: normalizeEmpty(lotRowSpot),
            destination_hub: destinationHub,
            locked_etn_date_time: normalizeEmpty(lockedEtnDateTime),
            unit_length: unitLength,
          },
        });

        remaining.delete(queryKey);
      }

      for (const queryKey of remaining) {
        const originalContainer = queryToOriginal.get(queryKey) || queryKey;
        results.push({
          cntr: originalContainer,
          eta_date: null,
          eta_time: null,
          error: 'Container not found in results',
        });
      }
    } catch (err) {
      const error = err as Error;
      console.error('[BNSF] Error in batch query:', error.message);
      for (const original of containerList) {
        if (!results.find((r) => r.cntr === original)) {
          results.push({ cntr: original, eta_date: null, eta_time: null, error: error.message });
        }
      }
    }

    return results;
  }
}
