/**
 * 轻量后端 API —— 手动触发抓取、读写要追踪的箱号列表、列显示配置。
 * 前端(web/)通过 Vite dev proxy 转发 /api/* 到这里，见 web/vite.config.ts。
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  loadRecords,
  saveRecords,
  loadColumns,
  saveColumns,
  KNOWN_COLUMNS,
  SUPPORTED_CARRIERS,
  type TrackingRecord,
  type ColumnDef,
} from './store.js';
import { BNSFCrawler } from './carriers/bnsf/index.js';
import { loadAccount, createSession, isValidSession, destroySession, parseCookies, SESSION_COOKIE } from './auth.js';
import { getSchedule, setScheduleHours, pauseSchedule, SCHEDULE_HOUR_OPTIONS } from './scheduler.js';

const app = express();
app.use(express.json());

function isSupportedCarrier(value: unknown): value is (typeof SUPPORTED_CARRIERS)[number] {
  return typeof value === 'string' && (SUPPORTED_CARRIERS as readonly string[]).includes(value);
}

function getSessionToken(req: Request): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
}

/** Cloud Scheduler 定时调 /trigger 用的——它没有浏览器 session，session cookie 那套认证走不通。
 * 只在配了 SCHEDULER_SECRET 环境变量时生效，本地开发不配就完全没这个后门。 */
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isValidSession(getSessionToken(req))) {
    next();
    return;
  }
  if (SCHEDULER_SECRET && req.headers['x-scheduler-secret'] === SCHEDULER_SECRET) {
    next();
    return;
  }
  res.status(401).json({ error: 'Not authenticated' });
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// ---------------------------------------------------------------------------
// Auth —— 单账号系统，登录状态用 httpOnly cookie + 内存 session token
// ---------------------------------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body as { username?: unknown; password?: unknown };
  const account = await loadAccount();
  if (username !== account.username || password !== account.password) {
    res.status(401).json({ error: 'Incorrect username or password' });
    return;
  }
  const token = createSession();
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  res.json({ companyName: account.companyName, username: account.username });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(getSessionToken(req));
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/session', async (req, res) => {
  if (!isValidSession(getSessionToken(req))) {
    res.json({ loggedIn: false });
    return;
  }
  const account = await loadAccount();
  res.json({ loggedIn: true, companyName: account.companyName, username: account.username });
});

app.use('/api/tracking', requireAuth);
app.use('/api/columns', requireAuth);
app.use('/api/schedule', requireAuth);

// ---------------------------------------------------------------------------
// Schedule —— 真正的服务器端定时任务(Cloud Scheduler)，不是浏览器 setInterval。
// 客户在界面上选 1/2/4/8 小时，改的是云端那个定时任务的 cron 表达式，关掉浏览器也照常跑。
// ---------------------------------------------------------------------------

app.get('/api/schedule', async (_req, res) => {
  try {
    res.json(await getSchedule());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read schedule' });
  }
});

app.put('/api/schedule', async (req, res) => {
  const { hours } = req.body as { hours?: unknown };
  if (typeof hours !== 'number' || !(SCHEDULE_HOUR_OPTIONS as readonly number[]).includes(hours)) {
    res.status(400).json({ error: `hours must be one of ${SCHEDULE_HOUR_OPTIONS.join(', ')}` });
    return;
  }
  try {
    await setScheduleHours(hours);
    res.json(await getSchedule());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update schedule' });
  }
});

app.delete('/api/schedule', async (_req, res) => {
  try {
    await pauseSchedule();
    res.json(await getSchedule());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to pause schedule' });
  }
});

// ---------------------------------------------------------------------------
// Tracking records
// ---------------------------------------------------------------------------

app.get('/api/tracking', async (_req, res) => {
  res.json(await loadRecords());
});

app.post('/api/tracking/containers', async (req, res) => {
  const body = req.body as { containerNumbers?: unknown; carrier?: unknown };
  if (!Array.isArray(body.containerNumbers)) {
    res.status(400).json({ error: 'containerNumbers must be an array' });
    return;
  }
  const carrier = body.carrier ?? 'BNSF';
  if (!isSupportedCarrier(carrier)) {
    res.status(400).json({ error: `Unsupported carrier "${carrier}". Supported: ${SUPPORTED_CARRIERS.join(', ')}` });
    return;
  }

  const records = await loadRecords();
  const next = [...records];
  const added: TrackingRecord[] = [];
  let reactivated = 0;

  for (const raw of body.containerNumbers) {
    const cno = String(raw).trim().toUpperCase();
    if (!cno) continue;

    // 已经在追踪中（未完成）的箱号 → 已存在，跳过。
    const active = next.find((r) => r.containerNumber.toUpperCase() === cno && !r.completedAt);
    if (active) continue;

    // 有"人工标记完成/dispatch"的历史记录（不是走完生命周期的 OUTGATED）→ 重新激活它，
    // 这是老流程：客户手动 dispatch 后同一个箱子又回来了，直接从 History 挪回来。
    const dispatched = next.find(
      (r) => r.containerNumber.toUpperCase() === cno && r.completedAt && r.status !== 'OUTGATED'
    );
    if (dispatched) {
      const idx = next.findIndex((r) => r.id === dispatched.id);
      next[idx] = { ...dispatched, completedAt: null };
      reactivated += 1;
      continue;
    }

    // 剩下两种情况都建一条全新记录：① 全新箱号；② 只剩 OUTGATED 历史记录——
    // OUTGATED 是上一段生命周期的存档，留在 History 不动，这次是全新的一票货，
    // 不复用旧记录（客户明确要求：同号再 add 不 reopen OUTGATED 的那条）。
    const record: TrackingRecord = {
      id: `${cno}-${Date.now()}`,
      containerNumber: cno,
      carrier,
      status: 'UNKNOWN',
      etaDate: null,
      etaTime: null,
      lastFreeDay: null,
      chassisNumber: null,
      lastHub: null,
      billYN: null,
      lotRowSpot: null,
      destinationHub: null,
      lockedEtnDateTime: null,
      unitLength: null,
      lastUpdated: null,
      completedAt: null,
    };
    added.push(record);
    next.push(record);
  }

  await saveRecords(next);
  res.json({ added: added.length, reactivated });
});

// 行级操作一律按记录 id（不是箱号）——因为 OUTGATED 归档后，同一个箱号可能同时存在
// 两条记录（History 里的 OUTGATED 存档 + 重新 add 的新 active），按箱号操作会误伤另一条。
app.delete('/api/tracking/records/:id', async (req, res) => {
  const target = req.params.id;
  const records = await loadRecords();
  const next = records.filter((r) => r.id !== target);
  await saveRecords(next);
  res.json({ deleted: records.length !== next.length });
});

/**
 * 标记完成/dispatch——不删除记录，只是从 Track All 和 Dashboard 统计里排除，挪去 History。可 Reopen 撤销。
 * 状态同时置为 OUTGATED：不管是自动判定（GROUNDED 后消失）还是人工点完成，进 History 就代表这个箱子
 * 这一段生命周期结束、已提离场站，History 里统一显示 OUTGATED，语义一致。
 */
app.post('/api/tracking/records/:id/complete', async (req, res) => {
  const target = req.params.id;
  const records = await loadRecords();
  const idx = records.findIndex((r) => r.id === target);
  if (idx === -1) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  records[idx] = { ...records[idx], status: 'OUTGATED', completedAt: new Date().toISOString() };
  await saveRecords(records);
  res.json(records[idx]);
});

/** 撤销完成——重新纳入 Track All 和 Dashboard 统计。状态回到 UNKNOWN，等下一次抓取重新判定（OUTGATED 不是抓取能产出的状态，留着会误导）。 */
app.post('/api/tracking/records/:id/reopen', async (req, res) => {
  const target = req.params.id;
  const records = await loadRecords();
  const idx = records.findIndex((r) => r.id === target);
  if (idx === -1) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  const wasOutgated = records[idx].status === 'OUTGATED';
  records[idx] = { ...records[idx], completedAt: null, status: wasOutgated ? 'UNKNOWN' : records[idx].status };
  await saveRecords(records);
  res.json(records[idx]);
});

function parseIds(body: unknown): string[] | null {
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return ids.map((c) => String(c));
}

/**
 * 批量删除——前端多选打勾之后用这个（按记录 id），而不是对每条分别调单条删除接口。
 * 单条接口是"读全部 -> 改一条 -> 存全部"，如果为了批量操作并发调用 N 次单条接口，
 * 多个请求各自读到同一份旧快照、各自存回去，后写的会把先写的改动覆盖掉——批量操作
 * 必须一次读、一次改完全部、一次存，避免这个竞态。
 */
app.post('/api/tracking/records/batch-delete', async (req, res) => {
  const targets = parseIds(req.body);
  if (!targets) {
    res.status(400).json({ error: 'ids must be a non-empty array' });
    return;
  }
  const targetSet = new Set(targets);
  const records = await loadRecords();
  const next = records.filter((r) => !targetSet.has(r.id));
  await saveRecords(next);
  res.json({ deleted: records.length - next.length });
});

/** 批量标记完成，同样的原因——一次读改存，不并发调单条接口。 */
app.post('/api/tracking/records/batch-complete', async (req, res) => {
  const targets = parseIds(req.body);
  if (!targets) {
    res.status(400).json({ error: 'ids must be a non-empty array' });
    return;
  }
  const targetSet = new Set(targets);
  const now = new Date().toISOString();
  let completed = 0;
  const records = await loadRecords();
  const next = records.map((r) => {
    if (!targetSet.has(r.id) || r.completedAt) return r;
    completed += 1;
    return { ...r, status: 'OUTGATED' as const, completedAt: now };
  });
  await saveRecords(next);
  res.json({ completed });
});

interface CrawlSummary {
  queried: number;
  found: number;
  notFound: number;
  errored: number;
}

/**
 * 跑一次爬虫并把结果写回 Sheet。可选 onProgress 回调用于流式进度上报。
 * /trigger 的两条路径（定时任务 JSON 版 + UI 流式版）都调这一个函数，逻辑只有一份。
 */
async function runCrawlAndSave(onProgress?: import('./carriers/base.js').CrawlProgressCallback): Promise<CrawlSummary> {
  const records = await loadRecords();
  const bnsfRecords = records.filter((r) => r.carrier === 'BNSF' && !r.completedAt);
  if (bnsfRecords.length === 0) {
    return { queried: 0, found: 0, notFound: 0, errored: 0 };
  }

  const crawler = new BNSFCrawler();
  const results = await crawler.crawl(bnsfRecords.map((r) => r.containerNumber), onProgress);
  const now = new Date().toISOString();
  const byContainer = new Map(results.map((r) => [r.cntr.toUpperCase(), r]));

    const updated = records.map((r) => {
      // 已完成/已归档的记录（completedAt 非空，含人工 dispatch 和 OUTGATED）永远不被抓取结果改动——
      // 它们是 History 里的存档。这一条也顺带防住"同号双记录"：一个箱号可能同时有一条 OUTGATED
      // 存档 + 一条重新 add 的新 active，新 active 的抓取结果绝不能回写到 OUTGATED 存档上。
      if (r.completedAt) return r;

      const result = byContainer.get(r.containerNumber.toUpperCase());
      if (!result) return r;

      // 抓取真的失败时(超时、页面结构变了这类，不是"查无此箱")原样保留上一次的数据，
      // 不要用 null 覆盖掉。一次网络抖动不该把客户已经拿到的真实字段清空——2026-08-18
      // 就真的发生过：4 个批次里有 1 个提交后 30 秒没响应，那 50 个箱号的 Last Hub/
      // Destination/Billing 全被清成空、状态变 ERROR，而这些数据上一轮明明是好的。
      // lastUpdated 也故意不更新：表格上那一列停在旧时间，本身就是"这条没刷新成功"的诚实信号。
      if (result.error && result.error !== 'Container not found in results') return r;

      const notFound = result.error === 'Container not found in results';

      // 生命周期收尾：上一轮还是 GROUNDED（已落地、有堆位），这一轮突然查不到了 →
      // 判定为已被提离场站（outgated）。标 OUTGATED、写 completedAt 自动归档进 History，
      // 不再参与后续抓取。保留上一轮的字段快照（Last Hub/Destination/LFD 等），只改状态和时间。
      if (notFound && r.status === 'GROUNDED') {
        return { ...r, status: 'OUTGATED' as const, lastUpdated: now, completedAt: now };
      }

      const extra = (result.extra ?? {}) as Record<string, string | null>;
      // Lot-Row-Spot 有值 = 箱子已经卸到场内具体的堆放位置了，这是"已落地"最直接的信号，
      // 比"有没有 ETA"更能说明实际状态——优先级放在 ACTIVE 前面。
      const status: TrackingRecord['status'] = result.error
        ? result.error === 'Container not found in results'
          ? 'UNKNOWN'
          : 'ERROR'
        : extra.lot_row_spot
          ? 'GROUNDED'
          : result.eta_date
            ? 'ACTIVE'
            : 'UNKNOWN';
      return {
        ...r,
        status,
        etaDate: result.eta_date,
        etaTime: result.eta_time,
        lastFreeDay: extra.storage_last_free_day ?? null,
        chassisNumber: extra.chassis_number ?? null,
        lastHub: extra.last_hub ?? null,
        billYN: extra.bill_yn ?? null,
        lotRowSpot: extra.lot_row_spot ?? null,
        destinationHub: extra.destination_hub ?? null,
        lockedEtnDateTime: extra.locked_etn_date_time ?? null,
        unitLength: extra.unit_length ?? null,
        lastUpdated: now,
      };
    });

    // 报警信号：算"非'查无此箱'原因"的失败率——箱号本身查不到是正常业务情况(箱子可能已经不在
    // BNSF 系统里了)，但如果一大批箱号都因为别的原因(超时、页面结构变了、站点连不上)查询失败，
    // 大概率是爬虫本身坏了，需要人去看。这行日志会被 Cloud Monitoring 的报警规则匹配到，发邮件通知。
    const realErrors = results.filter((r) => r.error && r.error !== 'Container not found in results').length;
  if (results.length > 0 && realErrors / results.length > 0.2) {
    console.error(
      `[ALERT] BNSF crawl failure rate high: ${realErrors}/${results.length} containers errored for reasons other than "not found" — crawler may be broken`
    );
  }

  await saveRecords(updated);
  return {
    queried: results.length,
    found: results.filter((r) => !r.error).length,
    notFound: results.filter((r) => r.error === 'Container not found in results').length,
    errored: realErrors,
  };
}

/**
 * 手动/定时触发抓取。两种响应形态：
 * - 默认（Cloud Scheduler 用）：跑完一次性返回 JSON，出错返回 500 让 scheduler 能感知失败重试。
 * - ?stream=1（前端 UI 用）：流式返回 NDJSON，每抓完一批推一行进度，给进度条实时更新。
 *   流式一旦开始就没法再改 HTTP 状态码了，出错也是 200——但 [ALERT] 日志照常打，
 *   Cloud Monitoring 的日志报警不受影响。
 */
app.post('/api/tracking/trigger', async (req, res) => {
  const stream = req.query.stream === '1';

  if (!stream) {
    try {
      const summary = await runCrawlAndSave();
      res.json(summary);
    } catch (err) {
      console.error('[ALERT] BNSF crawl trigger failed entirely:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'trigger failed' });
    }
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.flushHeaders?.();
  const write = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');
  try {
    const summary = await runCrawlAndSave((p) => write({ type: 'progress', ...p }));
    write({ type: 'done', ...summary });
  } catch (err) {
    console.error('[ALERT] BNSF crawl trigger failed entirely:', err);
    write({ type: 'error', message: err instanceof Error ? err.message : 'trigger failed' });
  } finally {
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Column display config — fixed field set, only visible/order can change
// ---------------------------------------------------------------------------

app.get('/api/columns', async (_req, res) => {
  res.json(await loadColumns());
});

app.put('/api/columns', async (req, res) => {
  const incoming = req.body as unknown;
  if (!Array.isArray(incoming)) {
    res.status(400).json({ error: 'Body must be an array of column definitions' });
    return;
  }

  const knownKeys = new Set(KNOWN_COLUMNS.map((c) => c.key));
  const incomingKeys = new Set((incoming as ColumnDef[]).map((c) => c?.key));

  if (incomingKeys.size !== (incoming as ColumnDef[]).length) {
    res.status(400).json({ error: 'Duplicate column key in submitted list' });
    return;
  }
  for (const key of knownKeys) {
    if (!incomingKeys.has(key)) {
      res.status(400).json({ error: `Column "${key}" is missing — columns cannot be removed, only shown/hidden/reordered` });
      return;
    }
  }
  for (const key of incomingKeys) {
    if (!knownKeys.has(key)) {
      res.status(400).json({ error: `Unknown column key "${key}" — columns are a fixed set, none can be added` });
      return;
    }
  }

  await saveColumns(incoming as ColumnDef[]);
  res.json(await loadColumns());
});

// ---------------------------------------------------------------------------
// 生产环境下顺带把前端静态文件也served了——单个 Cloud Run 服务，不用另外起一个前端托管。
// 本地开发不会命中这个分支：`npm run dev`(Vite)自己在 5173 起服务，web/dist 也不存在。
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.join(__dirname, '../web/dist');

app.use(express.static(WEB_DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

const PORT = parseInt(process.env.PORT || process.env.API_PORT || '8787');
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
