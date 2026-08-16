/**
 * 手动验证脚本：跑一次真实的 BNSF 抓取，确认登录+查询链路是否正常。
 * 用法：在 .env 里填好 BNSF_URL/BNSF_USERNAME/BNSF_PASSWORD 和真实箱号后：
 *   npm run verify:bnsf -- CONTAINER1,CONTAINER2
 */
import 'dotenv/config';
import { BNSFCrawler } from '../carriers/bnsf/index.js';

async function main() {
  const arg = process.argv[2];
  const containers = arg ? arg.split(',').map((s) => s.trim()) : ['YMMU6620500'];

  const crawler = new BNSFCrawler();
  console.log('Starting BNSF crawl verification for:', containers);
  const start = Date.now();
  try {
    const results = await crawler.crawl(containers);
    console.log(`Done in ${Date.now() - start}ms`);
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(`Failed after ${Date.now() - start}ms`);
    console.error(err);
    process.exit(1);
  }
}

main();
