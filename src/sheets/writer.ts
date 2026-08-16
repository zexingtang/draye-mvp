/**
 * 把抓取结果写入客户自己的 Google Sheet（Tracking tab）。
 *
 * 认证方式：用 google-auth-library 的默认凭证链（ADC），不依赖任何下载下来的
 * 密钥文件——本地开发时来自 `gcloud auth application-default login`，
 * 部署到 Cloud Run 后来自挂在服务上的服务账号，代码完全不用变。
 */

import { google } from 'googleapis';
import type { ContainerResult } from '../carriers/base.js';

const TRACKING_TAB = 'Tracking';
const HEADER_ROW = ['container_id', 'carrier', 'status', 'eta_date', 'eta_time', 'last_free_day', 'last_updated'];

function toRow(carrier: string, result: ContainerResult, updatedAt: string): (string | null)[] {
  const status = result.error ? 'ERROR' : result.eta_date ? 'ACTIVE' : 'UNKNOWN';
  return [
    result.cntr,
    carrier,
    status,
    result.eta_date,
    result.eta_time,
    result.extra?.storage_last_free_day ?? null,
    updatedAt,
  ];
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client as any });
}

/**
 * 确保 Tracking tab 存在且有表头；不存在就创建。
 */
async function ensureTrackingTab(sheetId: string): Promise<void> {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === TRACKING_TAB);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TRACKING_TAB } } }],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${TRACKING_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER_ROW] },
  });
}

/**
 * 把这一轮抓取结果整体覆盖写入 Tracking tab（表头之后的所有行清空重写）。
 * 客户不手动改这个 tab，所以覆盖写是安全的——这是固定契约，见 project_brief.md。
 */
export async function writeTrackingResults(
  sheetId: string,
  carrier: string,
  results: ContainerResult[]
): Promise<void> {
  await ensureTrackingTab(sheetId);
  const sheets = await getSheetsClient();

  const updatedAt = new Date().toISOString();
  const rows = results.map((r) => toRow(carrier, r, updatedAt));

  // 先清掉表头之后的旧数据，再写新数据，避免行数变少时留下脏数据
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${TRACKING_TAB}!A2:Z10000`,
  });

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TRACKING_TAB}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
  }
}
