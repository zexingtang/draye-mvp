/**
 * 手动验证脚本：抓一次 BNSF 真实/测试数据，写进一个测试 Sheet，确认端到端链路。
 * 用法：
 *   1. .env 里加一行 TEST_SHEET_ID=你的测试表格ID（表格URL里 /d/ 和 /edit 之间那段）
 *   2. 确保你的账号（或部署后的服务账号）对这个 Sheet 有编辑权限
 *   3. npm run verify:sheets -- CONTAINER1,CONTAINER2
 */
import 'dotenv/config';
import { BNSFCrawler } from '../carriers/bnsf/index.js';
import { writeTrackingResults } from '../sheets/writer.js';

async function main() {
  const sheetId = process.env.TEST_SHEET_ID;
  if (!sheetId) {
    throw new Error('请在 .env 里设置 TEST_SHEET_ID');
  }

  const arg = process.argv[2];
  const containers = arg ? arg.split(',').map((s) => s.trim()) : ['YMMU6620500'];

  console.log('Crawling:', containers);
  const crawler = new BNSFCrawler();
  const results = await crawler.crawl(containers);
  console.log('Crawl results:', JSON.stringify(results, null, 2));

  console.log('Writing to sheet:', sheetId);
  await writeTrackingResults(sheetId, 'BNSF', results);
  console.log('Done. Check the Tracking tab in the sheet.');
}

main().catch((err) => {
  console.error('verify:sheets failed:', err);
  process.exit(1);
});
