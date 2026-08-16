/**
 * 极简账号系统——每个部署只有一个客户公司、一个共享的管理员账号（不是多用户系统）。
 * 账号信息存在本地文件（跟 store.ts 的 tracking.json/columns.json 同一套"临时本地存储"模式，
 * 以后要迁移到客户自己的存储时，换掉这个文件的读写实现就行，上层接口不用动）。
 *
 * Session 用最简单的方式实现：内存里存一个 token 集合 + httpOnly cookie，没有用 JWT 或者
 * 第三方 session 库——单账号、单机部署，不需要那么复杂，重启服务会清空所有 session（等于强制重新登录，可接受）。
 */
import { randomBytes } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const ACCOUNT_FILE = path.join(DATA_DIR, 'account.json');

export interface Account {
  companyName: string;
  username: string;
  password: string;
}

async function ensureAccountFile(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(ACCOUNT_FILE, 'utf-8');
  } catch {
    const fallback: Account = { companyName: 'Draye', username: 'admin', password: 'changeme' };
    await writeFile(ACCOUNT_FILE, JSON.stringify(fallback, null, 2), 'utf-8');
  }
}

export async function loadAccount(): Promise<Account> {
  await ensureAccountFile();
  const raw = await readFile(ACCOUNT_FILE, 'utf-8');
  return JSON.parse(raw) as Account;
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
