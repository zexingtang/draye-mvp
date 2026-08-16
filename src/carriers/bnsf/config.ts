/**
 * BNSF 爬虫配置。换成免登录移动端接口之后不再需要账号密码，这里只剩超时/批量大小配置。
 */

import type { CrawlerOptions } from '../base.js';

export function getCrawlerOptions(): CrawlerOptions {
  return {
    defaultTimeout: parseInt(process.env.BNSF_DEFAULT_TIMEOUT || '30000'),
    navigationTimeout: parseInt(process.env.BNSF_NAVIGATION_TIMEOUT || '30000'),
    selectorTimeout: parseInt(process.env.BNSF_SELECTOR_TIMEOUT || '10000'),
  };
}

/**
 * BNSF 表单每次提交的箱号数量上限。BNSF 页面本身没有写死这个数字，
 * 目前是保守估计的默认值 —— 拿真实数据跑大批量时如果发现结果不全/报错，
 * 用 BNSF_BATCH_SIZE 环境变量调小；如果确认能承受更多，调大即可。
 */
export function getBatchSize(): number {
  return parseInt(process.env.BNSF_BATCH_SIZE || '50');
}
