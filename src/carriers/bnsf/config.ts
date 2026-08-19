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
 * BNSF 表单每次提交的箱号数量上限。
 *
 * 2026-08-19 拿真实箱号实测过 DLL 页面的硬上限：一次提交 100 个 → 全部正常返回；
 * 105/110/120/150 → 页面静默返回空（所有箱号都变成"查无此箱"，不报错、不提示）。
 * 所以真实上限正好是 100。这里默认设 90 留 10% 余量，不贴着硬边界跑——因为一旦超限，
 * 返回的是"全部查无此箱"这种会污染业务判断的假数据（还会误触发 OUTGATED 归档），
 * 比直接报错更危险。对 200 个以内的箱号，90 和 100 分的批次数一样，留余量零成本。
 * crawler 里另有护栏：整批全"查无此箱"会被当成查询失败处理，不会被当真。
 */
export function getBatchSize(): number {
  return parseInt(process.env.BNSF_BATCH_SIZE || '90');
}
