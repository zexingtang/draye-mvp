/**
 * 手动验证 UP 爬虫能否登录 + 查询（对标 verify-bnsf）。UP 登录偶尔会因为站点改版/账号问题挂，
 * 上线前或排查时跑一下：`npm run verify:up -- <箱号1> <箱号2> ...`（不带箱号用两个内置样例）。
 * 需要 .env 里有 UP_USERNAME / UP_PASSWORD。
 */
import 'dotenv/config';
import { UPCrawler } from '../carriers/up/index.js';

const containers = process.argv.slice(2);
if (containers.length === 0) containers.push('NYKU3685258', 'SMCU1115772');

(async () => {
  console.log(`[verify:up] querying ${containers.length} container(s): ${containers.join(', ')}`);
  const crawler = new UPCrawler();
  const results = await crawler.crawl(containers, (p) =>
    console.log(`  progress: ${p.processed}/${p.total} found=${p.found} notFound=${p.notFound} err=${p.errored}`)
  );
  console.log(JSON.stringify(results, null, 2));
  const found = results.filter((r) => !r.error).length;
  console.log(`[verify:up] done — ${found}/${results.length} found`);
})().catch((e) => {
  console.error('[verify:up] FAILED:', e.message);
  process.exit(1);
});
