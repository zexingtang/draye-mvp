/**
 * 给新客户建表：新建 Google Sheet（Tracking/Columns/Account 三个 tab + 表头）、写入客户账号信息、
 * 分享给部署服务用的服务账号。是 setup-sheet.ts 的参数化版本，onboard-customer.ps1 会调这个脚本，
 * 也可以单独手动跑。
 *
 * 用法：npx tsx src/dev/provision-sheet.ts "<公司名>" <用户名> <密码> [每日TrackAll上限] [解锁档位]
 *   例：... "Acme" admin pass123 5 8      → 每天最多 5 次手动 Track All、只解锁 8h 定时
 *   例：... "Acme" admin pass123           → 无限次数、全档位解锁（不传就是不限制）
 *
 * 只往 stdout 打印最后建好的 spreadsheetId 这一行（其他信息走 stderr）——方便脚本用
 * 命令替换直接拿到 ID，不用额外解析。
 */
import { google } from 'googleapis';
import { KNOWN_COLUMNS } from '../store.js';

const SERVICE_ACCOUNT_EMAIL = 'draye-crawler@draye-mvp.iam.gserviceaccount.com';

const TRACKING_HEADERS = [
  'id',
  'containerNumber',
  'carrier',
  'status',
  'etaDate',
  'etaTime',
  'lastFreeDay',
  'chassisNumber',
  'lastHub',
  'billYN',
  'lotRowSpot',
  'destinationHub',
  'lockedEtnDateTime',
  'unitLength',
  'lastUpdated',
  'completedAt',
];

const COLUMNS_HEADERS = ['key', 'label', 'visible', 'order'];
// 后 4 列是套餐配置/用量：maxTrackAllPerDay（空=无限）、allowedScheduleHours（逗号分隔，空=全部）、
// trackAllUsageDate/Count（运行时自动写，建表留空）。见 auth.ts。
const ACCOUNT_HEADERS = [
  'companyName',
  'username',
  'password',
  'maxTrackAllPerDay',
  'allowedScheduleHours',
  'trackAllUsageDate',
  'trackAllUsageCount',
];

async function main() {
  const [companyName, username, password, maxTrackAll, allowedHours] = process.argv.slice(2);
  if (!companyName || !username || !password) {
    console.error('用法: npx tsx src/dev/provision-sheet.ts "<公司名>" <用户名> <密码> [每日TrackAll上限] [解锁档位]');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client as any });
  const drive = google.drive({ version: 'v3', auth: client as any });

  console.error(`Creating sheet for "${companyName}"...`);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Draye Tracking Data — ${companyName}` },
      sheets: [
        { properties: { title: 'Tracking', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Columns', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Account', gridProperties: { frozenRowCount: 1 } } },
      ],
    },
  });
  const spreadsheetId = created.data.spreadsheetId!;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: 'Tracking!A1', values: [TRACKING_HEADERS] },
        { range: 'Columns!A1', values: [COLUMNS_HEADERS] },
        { range: 'Columns!A2', values: KNOWN_COLUMNS.map((c) => [c.key, c.label, c.visible, c.order]) },
        { range: 'Account!A1', values: [ACCOUNT_HEADERS] },
        {
          range: 'Account!A2',
          values: [[companyName, username, password, maxTrackAll ?? '', allowedHours ?? '', '', '']],
        },
      ],
    },
  });

  console.error(`Sharing with ${SERVICE_ACCOUNT_EMAIL}...`);
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'user', role: 'writer', emailAddress: SERVICE_ACCOUNT_EMAIL },
    sendNotificationEmail: false,
  });

  console.error(`Done: ${created.data.spreadsheetUrl}`);
  console.log(spreadsheetId);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
