/**
 * 极简账号系统——每个部署只有一个客户公司、一个共享的管理员账号（不是多用户系统）。
 * 账号信息存在跟 tracking/columns 同一个 Google Sheet 的 Account tab 里（见 store.ts /
 * sheets/client.ts）——不用本地文件，Cloud Run 重新部署/冷启动不会把账号密码冲掉。
 *
 * Session 用最简单的方式实现：内存里存一个 token 集合 + httpOnly cookie，没有用 JWT 或者
 * 第三方 session 库——单账号、单机部署，不需要那么复杂，重启服务会清空所有 session（等于强制重新登录，可接受）。
 */
import { randomBytes } from 'crypto';
import { readRows, cellToText } from './sheets/client.js';

const ACCOUNT_TAB = 'Account';

export interface Account {
  companyName: string;
  username: string;
  password: string;
}

export async function loadAccount(): Promise<Account> {
  const rows = await readRows(ACCOUNT_TAB);
  const row = rows[0];
  if (!row) throw new Error(`Account tab 里没有账号数据——检查 SHEET_ID 指向的表是不是用 setup-sheet.ts 建的`);
  return {
    companyName: cellToText(row[0]) ?? 'Draye',
    username: cellToText(row[1]) ?? 'admin',
    password: cellToText(row[2]) ?? '',
  };
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
