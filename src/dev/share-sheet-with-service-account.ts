/**
 * 一次性脚本：把 SHEET_ID 指向的表分享给 Cloud Run 部署要用的服务账号，给 Editor 权限。
 * Sheets API 认权限看的是 Drive 层的分享设置，不是 IAM role——服务账号不管挂了什么 IAM
 * 角色，没有被分享这张表就读写不了，跑这个脚本就是补上这一步。
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { getSheetId } from '../sheets/client.js';

const SERVICE_ACCOUNT_EMAIL = 'draye-crawler@draye-mvp.iam.gserviceaccount.com';

async function main() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
  const client = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: client as any });

  const fileId = getSheetId();
  await drive.permissions.create({
    fileId,
    requestBody: { type: 'user', role: 'writer', emailAddress: SERVICE_ACCOUNT_EMAIL },
    sendNotificationEmail: false,
  });

  console.log(`Shared ${fileId} with ${SERVICE_ACCOUNT_EMAIL} (writer).`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
