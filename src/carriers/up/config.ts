/**
 * UP (Union Pacific) 抓取配置。跟 BNSF 不一样，UP 需要登录（MyUPRR / SiteMinder SSO），
 * 所以要账号密码——从环境变量读，绝不硬编码（沿用项目一贯的安全约定）。
 * 生产环境把 UP_USERNAME/UP_PASSWORD 设成 Cloud Run 的环境变量；本地开发放 .env（已 gitignored）。
 */

export interface UPConfig {
  url: string;
  username: string;
  password: string;
}

/** 登录门户地址。默认就是 MyUPRR 的 CSV(Track Shipments) secure 页；一般不用改。 */
const DEFAULT_UP_URL = 'https://c02.my.uprr.com/myu/csv/secure/index.html#/search';

export function getUPConfig(): UPConfig {
  const username = (process.env.UP_USERNAME || '').trim();
  const password = (process.env.UP_PASSWORD || '').trim();
  if (!username || !password) {
    throw new Error('UP 抓取需要登录：请在环境变量里设置 UP_USERNAME 和 UP_PASSWORD（本地放 .env，生产放 Cloud Run 环境变量）。');
  }
  return {
    url: (process.env.UP_URL || DEFAULT_UP_URL).trim(),
    username,
    password,
  };
}

/**
 * 一次提交的箱号上限。UP 的 Track Shipments 输入框写着 "Enter up to 1000 Equipment IDs"，
 * 所以上限是 1000（比 BNSF 的 100 宽松得多）。留点余量，默认 900，可用 UP_BATCH_SIZE 调。
 */
export function getBatchSize(): number {
  return parseInt(process.env.UP_BATCH_SIZE || '900');
}

export function getTimeouts() {
  return {
    navigationTimeout: parseInt(process.env.UP_NAVIGATION_TIMEOUT || '60000'),
    loginTimeout: parseInt(process.env.UP_LOGIN_TIMEOUT || '60000'),
    searchTimeout: parseInt(process.env.UP_SEARCH_TIMEOUT || '60000'),
  };
}
