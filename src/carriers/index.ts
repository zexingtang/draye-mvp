/**
 * Carrier 爬虫注册表 —— 按 carrier 名拿到对应的爬虫实例。
 * 加新 carrier：写好 `carriers/<name>/`，在这里 case 一行，再在 store.ts 的 SUPPORTED_CARRIERS 加名字。
 */
import type { CarrierCrawler } from './base.js';
import { BNSFCrawler } from './bnsf/index.js';
import { UPCrawler } from './up/index.js';

export function getCrawler(carrier: string): CarrierCrawler {
  switch (carrier) {
    case 'BNSF':
      return new BNSFCrawler();
    case 'UP':
      return new UPCrawler();
    default:
      throw new Error(`No crawler registered for carrier "${carrier}"`);
  }
}
