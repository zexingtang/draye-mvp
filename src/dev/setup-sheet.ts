/**
 * 一次性脚本：建立正式的存储用 Google Sheet（Tracking/Columns/Account 三个 tab + 表头）。
 * 跑完把打印出来的 spreadsheetId 填进 .env 的 SHEET_ID，之后 store.ts/auth.ts 都读写这一个表。
 * 只需要跑一次；重复跑会创建新的表，不会复用已有的。
 */
import { google } from 'googleapis';
import { KNOWN_COLUMNS } from '../store.js';

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
const ACCOUNT_HEADERS = ['companyName', 'username', 'password'];

async function main() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client as any });

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'Draye Tracking Data' },
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
        {
          range: 'Columns!A2',
          values: KNOWN_COLUMNS.map((c) => [c.key, c.label, c.visible, c.order]),
        },
        { range: 'Account!A1', values: [ACCOUNT_HEADERS] },
        { range: 'Account!A2', values: [['Draye', 'admin', 'changeme']] },
      ],
    },
  });

  console.log('Created spreadsheet:', spreadsheetId);
  console.log('URL:', created.data.spreadsheetUrl);
  console.log('\nAdd this to .env:');
  console.log(`SHEET_ID=${spreadsheetId}`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
