# 项目背景

这是"集装箱 Tracking 自动化"项目的 **2.0 精简版仓库**，独立于旧的多租户 SaaS 项目
（`../Saasworkflowautomationapp`）。旧仓库半年前按传统多租户 SaaS 思路开发到一半，
卡在"每个客户 Dispatch/Invoice 需求都不一样、UI 很难泛化"这个死结上，决定转型。

完整背景和历次架构讨论见上级目录的 `../project_brief.md`。

## 这一版 MVP 的范围（只做这些）

- 自动 Tracking：定时抓取 BNSF（只做这一个 carrier，其他 carrier 里 UP 的登录流程之前
  验证过不稳定，CNHAR 未验证，都不在这版范围）
- 查询频率客户自己可设置、支持手动触发查询
- 一个 Dashboard（只含 Tracking 相关指标，不含依赖 Invoice 数据的财务卡片）
- 不做：Dispatch、Invoice、Driver App、多租户账号、计费系统

## 核心架构原则

- **不在自己的数据库/项目里长期存客户数据**——爬虫抓完直接写客户自己的 Google
  Sheet/Drive；这个决定也是选个人 Google 账号先开发、以后再迁移到公司账号"不担心
  数据迁移"的原因（没有需要迁移的数据，迁移=把同一份无状态代码重新部署一次）。
- **UI 尽量复用旧仓库已经做好的**——`Saasworkflowautomationapp/src/app/components/`
  下的 `TrackingModule.tsx`、`DashboardModule.tsx` 交互逻辑已经很完整（查询频率下拉、
  手动 Track All 按钮都已存在），迁移时优先复用组件本身，只替换背后的数据获取逻辑
  （原来是 Supabase，这版换成读写 Google Sheet 的轻量后端）。
- **carrier 抓取用统一接口**：`src/carriers/base.ts` 定义 `CarrierCrawler.crawl()`，
  每个 carrier 一个适配器文件夹，加新 carrier 不改动其他代码。
- **列是固定的，客户只能选显示/隐藏，不能自定义**——`TrackingRecord` 的字段全部来自
  爬虫，`store.ts` 里的 `KNOWN_COLUMNS` 是权威定义（14 个固定字段），`GET/PUT
  /api/columns` 只允许改 visible/order，提交的列表跟 `KNOWN_COLUMNS` 的 key 集合对
  不上就直接拒绝。**这个决定是反复过的**：一开始做过一整套"客户自定义列 + 客户可复用
  下拉字段（Resources）"，包括详情编辑弹窗、Excel 批量导入，全部实现并测过，后来用户
  觉得这是"定制化"、不需要，改成现在这个更简单的版本——如果以后又要做自定义字段，
  `TASKS.md` 里"可扩展列…已被推翻"那一节记录了完整设计，不用重新想。
- **集装箱生命周期与 OUTGATED 归档**——状态 `ACTIVE`(有 ETA)→ `GROUNDED`(有堆位/已落地)
  → 若 GROUNDED 的箱子下一轮抓取**彻底查不到了**(notFound)，判定为已提离场站，标 `OUTGATED`、
  自动写 `completedAt` 归档进 History，不再抓取。注意区分：GROUNDED 箱子若仍能查到但丢了堆位/
  ETA，只是变 `UNKNOWN`，不是 OUTGATED——OUTGATED 只在"消失"时触发。抓取更新时**跳过所有已完成
  记录**(completedAt 非空)，历史存档永不被回写。
- **同号可以有多条记录 + 行操作按 id 不按箱号**——OUTGATED 归档后，同一个箱号再次 add 会新建
  一条全新记录（不 reopen 那条 OUTGATED 存档，那是上一段生命周期的货）；人工 dispatch(非 OUTGATED)
  的历史记录仍走 reopen 老逻辑。由此同号可能同时有 History 存档 + 新 active 两条，所以删除/完成/
  reopen/批量这些行级操作全部按记录 `id`（`/api/tracking/records/:id`），不能按箱号，否则会误伤另一条。
- **账号套餐（额度/档位限制）**——Account tab 后 4 列：`maxTrackAllPerDay`（每日手动 Track All 上限，空=无限）、
  `allowedScheduleHours`（解锁的定时档位，逗号分隔，空=全部）、`trackAllUsageDate`/`trackAllUsageCount`
  （用量，按 UTC 日期跨天归零，运行时写）。老账号没这些列 → 默认无限+全解锁，现有客户不受影响。
  手动 Track All（`?stream=1`）先 `consumeTrackAll` 消费额度、超限 429；定时任务不受限。环境变量
  `PLAN_MAX_TRACK_ALL_PER_DAY` / `PLAN_ALLOWED_SCHEDULE_HOURS` 可覆盖套餐用于测试模拟，不动 Sheet 数据。
  开账号时用 `onboard-customer.ps1 -MaxTrackAllPerDay 5 -AllowedScheduleHours "8"` 配置。见 `auth.ts`。
- **单账号登录，不是多用户系统**——`src/auth.ts` + `data/account.json`（companyName +
  username + password，明文，`.gitignore` 里排除了）。一个部署只服务一个客户公司，
  所以只有一个共享的管理员账号，没有做用户列表/角色/权限这些多用户才需要的东西。
  Session 是内存里的 token 集合 + httpOnly cookie，没引入 JWT 或 session 库，服务重启
  会清空 session（等于强制重新登录），这个量级的项目不需要更重的方案。

## 已知的技术债 / 踩过的坑

- **BNSF 现在打的是免登录移动端接口**（`https://m.bnsf.com/bnsf.was6/dillApp/rprt`），
  不是最早那套桌面登录页面，不需要账号密码。这是踩了好几轮坑才换过来的，两个关键点
  别忘了：
  1. **查询箱号要去掉最后一位校验位**（11 位标准箱号 → 10 位设备号），带校验位提交
     会报 "invalid"，不是账号问题，也不是箱号不存在。
  2. **多个箱号只能用空格分隔，不能用逗号**——这个页面输入框有自己的前端逻辑，逗号
     分隔会诡异地把逗号翻倍，导致提交内容错误。
  3. **数字部分要去掉前导零**：去校验位之后，数字段前面的 0 也要全去掉（BEAU0274496 →
     去校验位 BEAU027449 → 去前导零 BEAU27449；BEAU0000095 → BEAU9）。BNSF 按不带前导零
     的设备号匹配。结果解析时对返回的 unitNumber 也要同样处理，否则对不回原始箱号。
  4. **一次查询最多 100 个箱号**（2026-08-19 拿真实数据实测：100 正常，105+ 页面**静默
     返回空**——所有箱号都变"查无此箱"，不报错不提示）。这个静默失败很危险：会污染业务
     判断（还会误触发下面说的 OUTGATED 归档）。所以默认批量设 90 留余量（`BNSF_BATCH_SIZE`），
     且 crawler 有护栏：整批全"查无此箱"会被重贴成真实错误、当查询失败处理，不当真。
  
  如果以后想把 Playwright 换成纯 HTTP 请求（这个页面看起来是普通表单 POST，理论上
  可行）：直接 POST 会因为 session 处理失败（观察到两个 JSESSIONID，比预期复杂），
  没深入查，如果有人想继续这个方向，从这里接着查。
- 旧仓库 `server/src/services/bnsf/config.ts` 曾经硬编码了真实账号密码作为默认值
  兜底——这个问题现在已经不存在了，因为免登录接口根本不需要账号密码。这个教训（不要
  为了"方便测试"加默认凭证兜底）在其他 carrier 需要账号密码时还是要记住。
- BNSF 免登录页面有个 `ETN` 字段（当前列名"Locked ETN Date Time"），含义没有权威文档确认——查过 UP/BNSF 术语表，`Notify`（铁路通知货代"箱子可以提了"）是个真实存在的行业概念，`ETN` 很可能是它的缩写，但没找到实锤，没有贸然改名，先保持原样。
- 旧仓库 `server/src/services/up/` 目录下堆了 50+ 个带时间戳的调试截图/日志文件，
  说明 UP 的登录流程一直不稳定（大概率是反爬/多步验证）。这版没有把 UP 迁移过来，
  以后真要支持 UP，先诊断清楚它到底是"选择器脆弱"还是"真的被拦截"，也可以先查一下
  UP 有没有类似 BNSF 这样的免登录查询入口，别急着直接搬登录版代码。

## 基础设施

- **GCP 项目**：`draye-mvp`（个人账号 fallinto2@gmail.com 下）。Sheets/Drive/Run/Build/Artifact Registry/Scheduler API 都已启用。
- **服务账号**：`draye-crawler@draye-mvp.iam.gserviceaccount.com` —— 这个 org 禁止下载服务账号密钥文件，认证统一走 ADC（本地开发用 `gcloud auth application-default login`，Cloud Run 部署后直接把这个服务账号挂在服务上，不需要密钥文件）。Cloud Run 服务本身也是用这个账号跑的。
- **本地 ADC 认证走的是自建 OAuth 客户端，不是 gcloud 自带的**——`gcloud auth application-default login` 默认用 Google 自己那个共享 OAuth 客户端，对 Sheets/Drive 这类"敏感" scope 没走完 Google 的验证流程，会被直接拒绝（不是"未验证应用"警告页那种能点"继续"的，是硬拒绝）。解法：在 Cloud Console 自己建一个 Desktop 类型的 OAuth 客户端（当前叫 "Draye"，同意屏幕设成"外部+测试"，测试用户加了 fallinto2@gmail.com），登录命令带 `--client-id-file` 指向这个客户端的 JSON。存储用的 Sheet ID 在 `.env` 的 `SHEET_ID`。
- **正式存储**：一个 Google Sheet（`Draye Tracking Data`），三个 tab（Tracking/Columns/Account），已经分享给上面那个服务账号（Editor 权限）——Sheets API 的权限看 Drive 层分享设置，不看 IAM role，服务账号不管挂什么角色，没被分享这张表就读写不了。
- **线上服务**：`https://draye-mvp-373319016662.us-central1.run.app`，Cloud Run，us-central1。`SCHEDULER_SECRET` 环境变量给 Cloud Scheduler 用（见 `src/auth.ts` 的 `requireAuth`）。
- **Cloud Scheduler**：`draye-track-all` 任务，抓取间隔现在是通过 Tracking 页面的 Schedule 下拉菜单真实控制的（1/2/4/8 小时可选，`src/scheduler.ts`），不是写死的。
- **监控报警**：Cloud Monitoring，邮箱通知渠道 + 三条规则（服务连不上/5xx/爬虫失败率过高），细节见 TASKS.md 对应章节。
- **数据备份**：Cloud Storage bucket `draye-mvp-backups`（us-central1，90 天自动过期），每次写入 Sheet 成功后顺带把原始行数据快照过去（`src/backup.ts`，接在 `store.ts` 的 `saveRecords`/`saveColumns`）。一个 bucket 服务所有客户部署，按 SHEET_ID 分区。跟主 Sheet 是完全独立的存储/独立的失败域，Sheet 或者这个 Google 账号出问题不影响备份还在。
- **给新客户开通**：`scripts/onboard-customer.ps1`——一条命令建 Sheet、部署独立 Cloud Run 服务、建独立 Scheduler 任务。现在是"一个客户一套部署"，不是多租户共用一套服务。
- **GitHub**：`https://github.com/zexingtang/draye-mvp`，已配置为 `origin` remote，本地已经提交过三次，**推送这个环境的自动模式分类器会拦，用户自己在本地终端跑**（`git push -u origin master`）。

## 进度

见 `TASKS.md`，权威进度记录，新会话先读这个文件。
