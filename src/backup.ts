/**
 * 数据备份——防止 Sheet 数据丢失/损坏时没法恢复。Sheet 本身在 Drive 那层有版本历史，
 * 但那是"客户 Google 账号自己的功能"，不是我们能编程控制的独立副本，也只能在网页里
 * 手动一步步回滚。这里做的是：每次 Tracking/Columns 写入 Sheet 成功后，顺带把这次写入
 * 的原始数据快照成一份 JSON，存到一个跟 Sheet 完全独立的 Cloud Storage bucket
 * （`draye-mvp-backups`，90 天自动过期，见 bucket 的 lifecycle 配置）——哪怕这个
 * Google 账号或者这张 Sheet 本身出问题，快照还在别的地方。
 *
 * 存的是"这次写入 Sheet 的原始行数据"（跟 sheets/client.ts 的 rows 格式完全一致），
 * 不是解析后的业务对象——这样真出事需要恢复时，可以直接把某个时间点的快照原样写回
 * Sheet，不需要额外的反序列化逻辑。
 *
 * 一个 bucket 服务所有客户部署：对象路径按 `{SHEET_ID}/{tab}/{timestamp}.json` 分区，
 * 每个客户的 SHEET_ID 天然不同，不会互相覆盖——onboard-customer.ps1 新开客户时用的是
 * 同一个 draye-crawler 服务账号，不需要为新客户单独建 bucket 或改动开通脚本。
 *
 * 备份失败不能影响主流程（客户点 Track All，不该因为备份写入失败就跟着报错），所以
 * 这里的函数自己吞掉错误，只打一行 [ALERT] 日志——这个前缀会被已有的 Cloud Monitoring
 * 日志报警规则（见 TASKS.md"监控报警"一节，规则本身是广泛匹配 [ALERT] 前缀，不是只认
 * 爬虫失败那一种消息）自动捕获发邮件，不需要为备份单独建一条新报警规则。
 */
import { google, type storage_v1 } from 'googleapis';

const BUCKET = process.env.BACKUP_BUCKET || 'draye-mvp-backups';

let cachedClient: storage_v1.Storage | null = null;

async function getClient(): Promise<storage_v1.Storage> {
  if (cachedClient) return cachedClient;
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] });
  const client = await auth.getClient();
  cachedClient = google.storage({ version: 'v1', auth: client as any });
  return cachedClient;
}

/** fire-and-forget 调用——调用方不 await 这个函数的完成，只是启动它。 */
export async function backupTab(tab: string, rows: unknown[][]): Promise<void> {
  try {
    const sheetId = process.env.SHEET_ID || 'unknown-sheet';
    const storage = await getClient();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await storage.objects.insert({
      bucket: BUCKET,
      name: `${sheetId}/${tab}/${timestamp}.json`,
      media: { mimeType: 'application/json', body: JSON.stringify(rows) },
    });
  } catch (err) {
    console.error(`[ALERT] Backup snapshot failed for tab "${tab}":`, err);
  }
}
