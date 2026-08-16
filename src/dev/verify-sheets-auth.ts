/** 一次性的认证冒烟测试：确认 ADC 能建表、能写，用完可以删这个文件。不碰真实业务数据。 */
import { google } from 'googleapis';

async function main() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client as any });

  const created = await sheets.spreadsheets.create({
    // 显式指定 tab 名字——不指定的话 Google 会按账号语言给默认名字（比如中文账号建出来的
    // 第一个 tab 叫"工作表1"不是"Sheet1"），写入时按 'Sheet1!A1' 找不到范围就会报错。
    requestBody: { properties: { title: 'draye-mvp test sheet (safe to delete)' }, sheets: [{ properties: { title: 'Sheet1' } }] },
  });
  const sheetId = created.data.spreadsheetId!;
  console.log('Created test sheet:', sheetId);
  console.log('URL:', created.data.spreadsheetUrl);

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [['auth check ok', new Date().toISOString()]] },
  });
  console.log('Write succeeded.');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
