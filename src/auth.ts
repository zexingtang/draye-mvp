/**
 * 极简账号系统——每个部署只有一个客户公司、一个共享的管理员账号（不是多用户系统）。
 * 账号信息存在跟 tracking/columns 同一个 Google Sheet 的 Account tab 里（见 store.ts /
 * sheets/client.ts）——不用本地文件，Cloud Run 重新部署/冷启动不会把账号密码冲掉。
 *
 * Session 用最简单的方式实现：内存里存一个 token 集合 + httpOnly cookie，没有用 JWT 或者
 * 第三方 session 库——单账号、单机部署，不需要那么复杂，重启服务会清空所有 session（等于强制重新登录，可接受）。
 */
import { randomBytes } from 'crypto';
import { readRows, overwriteRows, cellToText } from './sheets/client.js';

const ACCOUNT_TAB = 'Account';

/** 全部 schedule 档位；套餐没配 allowedScheduleHours 时默认全部解锁（老账号向后兼容）。 */
const ALL_SCHEDULE_HOURS = [1, 2, 4, 8];

/**
 * 套餐配置——决定这个账号能用到哪些额度/档位。存在 Account tab 里（每个客户一套，随 Sheet 迁移）。
 * 老账号（Sheet 里没有这些列）默认拿到"无限额度 + 全档位解锁"，不受影响。
 */
export interface Plan {
  /** 每天手动 Track All 的次数上限；null = 无限 */
  maxTrackAllPerDay: number | null;
  /** 解锁的 schedule 档位（小时），其余档位在界面上锁住并提示升级 */
  allowedScheduleHours: number[];
}

export interface Account {
  companyName: string;
  username: string;
  password: string;
  plan: Plan;
  /** 手动 Track All 用量记录（按 UTC 日期，跨天自动归零） */
  trackAllUsageDate: string | null;
  trackAllUsageCount: number;
}

/** UTC 当天的 YYYY-MM-DD，用来判断用量是不是该归零了。 */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 环境变量可以覆盖套餐（给测试/模拟受限用户用，不动 Sheet 里的真实账号数据）。 */
function applyPlanEnvOverride(plan: Plan): Plan {
  const maxEnv = process.env.PLAN_MAX_TRACK_ALL_PER_DAY;
  const hoursEnv = process.env.PLAN_ALLOWED_SCHEDULE_HOURS;
  return {
    maxTrackAllPerDay:
      maxEnv === undefined
        ? plan.maxTrackAllPerDay
        : maxEnv === '' || maxEnv.toLowerCase() === 'unlimited'
          ? null
          : parseInt(maxEnv, 10),
    allowedScheduleHours: hoursEnv
      ? hoursEnv.split(',').map((h) => parseInt(h.trim(), 10)).filter((h) => !Number.isNaN(h))
      : plan.allowedScheduleHours,
  };
}

function parseAccountRow(row: unknown[]): Account {
  const maxRaw = cellToText(row[3]); // D 列：每日 Track All 上限，空=无限
  const hoursRaw = cellToText(row[4]); // E 列：解锁档位，逗号分隔，空=全部
  const countRaw = cellToText(row[6]); // G 列：今日已用次数
  const plan: Plan = {
    maxTrackAllPerDay: maxRaw === null ? null : parseInt(maxRaw, 10),
    allowedScheduleHours: hoursRaw
      ? hoursRaw.split(',').map((h) => parseInt(h.trim(), 10)).filter((h) => !Number.isNaN(h))
      : [...ALL_SCHEDULE_HOURS],
  };
  return {
    companyName: cellToText(row[0]) ?? 'Draye',
    username: cellToText(row[1]) ?? 'admin',
    password: cellToText(row[2]) ?? '',
    plan: applyPlanEnvOverride(plan),
    trackAllUsageDate: cellToText(row[5]), // F 列：用量日期
    trackAllUsageCount: countRaw === null ? 0 : parseInt(countRaw, 10) || 0,
  };
}

function accountToRow(a: Account): unknown[] {
  return [
    a.companyName,
    a.username,
    a.password,
    a.plan.maxTrackAllPerDay === null ? '' : a.plan.maxTrackAllPerDay,
    a.plan.allowedScheduleHours.join(','),
    a.trackAllUsageDate ?? '',
    a.trackAllUsageCount,
  ];
}

export async function loadAccount(): Promise<Account> {
  const rows = await readRows(ACCOUNT_TAB);
  const row = rows[0];
  if (!row) throw new Error(`Account tab 里没有账号数据——检查 SHEET_ID 指向的表是不是用 setup-sheet.ts 建的`);
  return parseAccountRow(row);
}

/** 今天已用的 Track All 次数（跨天自动算 0）。 */
export function usedTrackAllToday(account: Account): number {
  return account.trackAllUsageDate === todayUTC() ? account.trackAllUsageCount : 0;
}

/**
 * 尝试消费一次手动 Track All 额度：没超限就 +1 并写回 Sheet，返回是否允许 + 用量情况。
 * maxTrackAllPerDay 为 null（无限）时永远允许、也不写用量。跨天自动从 0 重新计数。
 * 只在手动触发（界面按钮）时调用；定时任务不受额度限制。
 */
export async function consumeTrackAll(): Promise<{ allowed: boolean; usedToday: number; limit: number | null }> {
  const account = await loadAccount();
  const limit = account.plan.maxTrackAllPerDay;
  if (limit === null) return { allowed: true, usedToday: 0, limit: null };

  const today = todayUTC();
  const used = usedTrackAllToday(account);
  if (used >= limit) return { allowed: false, usedToday: used, limit };

  const updated: Account = { ...account, trackAllUsageDate: today, trackAllUsageCount: used + 1 };
  await overwriteRows(ACCOUNT_TAB, [accountToRow(updated)]);
  return { allowed: true, usedToday: used + 1, limit };
}

export const SESSION_COOKIE = 'draye_session';

const activeSessions = new Set<string>();

export function createSession(): string {
  const token = randomBytes(24).toString('hex');
  activeSessions.add(token);
  return token;
}

export function isValidSession(token: string | null): boolean {
  return token !== null && activeSessions.has(token);
}

export function destroySession(token: string | null): void {
  if (token) activeSessions.delete(token);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}
