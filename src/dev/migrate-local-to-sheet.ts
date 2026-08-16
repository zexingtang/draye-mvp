/**
 * 一次性脚本：把本地 data/*.json 里现有的真实测试数据（55 个箱号、列显示自定义、
 * Newgen 测试账号）搬进 SHEET_ID 指向的 Sheet。只需要在切换到 Sheets 存储那一次跑，
 * 跑完 store.ts/auth.ts 就完全从 Sheet 读写了，这个脚本之后可以删。
 */
import 'dotenv/config';
import { readFile } from 'fs/promises';
import path from 'path';
import { overwriteRows } from '../sheets/client.js';
import type { TrackingRecord, ColumnDef } from '../store.js';
import type { Account } from '../auth.js';

const DATA_DIR = path.join(process.cwd(), 'data');

function recordToRow(r: TrackingRecord): unknown[] {
  return [
    r.id,
    r.containerNumber,
    r.carrier,
    r.status,
    r.etaDate ?? '',
    r.etaTime ?? '',
    r.lastFreeDay ?? '',
    r.chassisNumber ?? '',
    r.lastHub ?? '',
    r.billYN ?? '',
    r.lotRowSpot ?? '',
    r.destinationHub ?? '',
    r.lockedEtnDateTime ?? '',
    r.unitLength ?? '',
    r.lastUpdated ?? '',
    r.completedAt ?? '',
  ];
}

async function main() {
  const records = JSON.parse(await readFile(path.join(DATA_DIR, 'tracking.json'), 'utf-8')) as TrackingRecord[];
  const columns = JSON.parse(await readFile(path.join(DATA_DIR, 'columns.json'), 'utf-8')) as ColumnDef[];
  const account = JSON.parse(await readFile(path.join(DATA_DIR, 'account.json'), 'utf-8')) as Account;

  console.log(`Migrating ${records.length} tracking records, ${columns.length} columns, 1 account...`);

  await overwriteRows('Tracking', records.map(recordToRow));
  await overwriteRows('Columns', columns.map((c) => [c.key, c.label, c.visible, c.order]));
  await overwriteRows('Account', [[account.companyName, account.username, account.password]]);

  console.log('Done.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
