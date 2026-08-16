/**
 * Google Sheets 客户端——认证走 ADC（google-auth-library 默认凭证链），不依赖下载的密钥文件。
 * 本地开发：`gcloud auth application-default login`（要带 spreadsheets/drive scope，见 CLAUDE.md）。
 * Cloud Run 部署后：换成挂载在服务上的服务账号，这个模块的代码完全不用改。
 */
import { google, type sheets_v4 } from 'googleapis';

let cachedClient: sheets_v4.Sheets | null = null;

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (cachedClient) return cachedClient;
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();
  cachedClient = google.sheets({ version: 'v4', auth: client as any });
  return cachedClient;
}

export function getSheetId(): string {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error('SHEET_ID 没配置——先跑 src/dev/setup-sheet.ts 建表，把打印出来的 ID 填进 .env');
  return id;
}

/** 整体覆盖某个 tab 表头之后的所有数据行——先清空再写，避免行数变少时留下脏数据。 */
export async function overwriteRows(tab: string, rows: unknown[][]): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tab}!A2:Z10000` });
  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
  }
}

/** 读表头之后的所有数据行；UNFORMATTED_VALUE 保证布尔/数字读回来是原始类型，不是格式化字符串。 */
export async function readRows(tab: string): Promise<unknown[][]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${tab}!A2:Z10000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (res.data.values ?? []) as unknown[][];
}

/** 空字符串/undefined 统一当 null——跟本地 JSON 版本的 `?? null` 语义保持一致。 */
export function cellToText(v: unknown): string | null {
  return v === undefined || v === null || v === '' ? null : String(v);
}
