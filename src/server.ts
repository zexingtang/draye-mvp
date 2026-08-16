/**
 * 轻量后端 API —— 手动触发抓取、读写要追踪的箱号列表、列显示配置。
 * 前端(web/)通过 Vite dev proxy 转发 /api/* 到这里，见 web/vite.config.ts。
 */
import 'dotenv/config';
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

const app = express();
app.use(express.json());

function isSupportedCarrier(value: unknown): value is (typeof SUPPORTED_CARRIERS)[number] {
  return typeof value === 'string' && (SUPPORTED_CARRIERS as readonly string[]).includes(value);
}

function getSessionToken(req: Request): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isValidSession(getSessionToken(req))) {
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
  const byNumber = new Map(records.map((r) => [r.containerNumber.toUpperCase(), r]));
  const next = [...records];
  const added: TrackingRecord[] = [];
  let reactivated = 0;

  for (const raw of body.containerNumbers) {
    const cno = String(raw).trim().toUpperCase();
    if (!cno) continue;
    const existing = byNumber.get(cno);
    if (existing) {
      // 已完成的箱号再次被添加 = 重新激活追踪，而不是当成"已存在"静默跳过。
      if (existing.completedAt) {
        const idx = next.findIndex((r) => r.id === existing.id);
        next[idx] = { ...existing, completedAt: null };
        reactivated += 1;
      }
      continue;
    }
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
    byNumber.set(cno, record);
    added.push(record);
    next.push(record);
  }

  await saveRecords(next);
  res.json({ added: added.length, reactivated });
});

app.delete('/api/tracking/containers/:containerNumber', async (req, res) => {
  const target = req.params.containerNumber.toUpperCase();
  const records = await loadRecords();
  const next = records.filter((r) => r.containerNumber.toUpperCase() !== target);
  await saveRecords(next);
  res.json({ deleted: records.length !== next.length });
});

/** 标记完成/dispatch——不删除记录，只是从 Track All 和 Dashboard 统计里排除，挪去 History。可 Reopen 撤销。 */
app.post('/api/tracking/containers/:containerNumber/complete', async (req, res) => {
  const target = req.params.containerNumber.toUpperCase();
  const records = await loadRecords();
  const idx = records.findIndex((r) => r.containerNumber.toUpperCase() === target);
  if (idx === -1) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }
  records[idx] = { ...records[idx], completedAt: new Date().toISOString() };
  await saveRecords(records);
  res.json(records[idx]);
});

/** 撤销完成——重新纳入 Track All 和 Dashboard 统计。 */
app.post('/api/tracking/containers/:containerNumber/reopen', async (req, res) => {
  const target = req.params.containerNumber.toUpperCase();
  const records = await loadRecords();
  const idx = records.findIndex((r) => r.containerNumber.toUpperCase() === target);
  if (idx === -1) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }
  records[idx] = { ...records[idx], completedAt: null };
  await saveRecords(records);
  res.json(records[idx]);
});

/** 手动触发：拿当前登记的、未完成的、carrier=BNSF 的箱号（目前唯一支持的），真的去跑一次爬虫。已完成(dispatch)的箱号不再查询。 */
app.post('/api/tracking/trigger', async (_req, res) => {
  try {
    const records = await loadRecords();
    const bnsfRecords = records.filter((r) => r.carrier === 'BNSF' && !r.completedAt);
    if (bnsfRecords.length === 0) {
      res.json({ queried: 0 });
      return;
    }

    const crawler = new BNSFCrawler();
    const results = await crawler.crawl(bnsfRecords.map((r) => r.containerNumber));
    const now = new Date().toISOString();
    const byContainer = new Map(results.map((r) => [r.cntr.toUpperCase(), r]));

    const updated = records.map((r) => {
      const result = byContainer.get(r.containerNumber.toUpperCase());
      if (!result) return r;
      const status: TrackingRecord['status'] = result.error
        ? result.error === 'Container not found in results'
          ? 'UNKNOWN'
          : 'ERROR'
        : result.eta_date
          ? 'ACTIVE'
          : 'UNKNOWN';
      const extra = (result.extra ?? {}) as Record<string, string | null>;
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

    await saveRecords(updated);
    res.json({ queried: results.length });
  } catch (err) {
    console.error('[server] trigger failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'trigger failed' });
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

const PORT = parseInt(process.env.API_PORT || '8787');
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
