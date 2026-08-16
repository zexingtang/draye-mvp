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
- **Cloud Scheduler**：`draye-track-all` 任务，每 6 小时调一次 `/api/tracking/trigger`。
- **GitHub**：`https://github.com/zexingtang/draye-mvp`，已配置为 `origin` remote，本地已经提交过两次，**推送这个环境的自动模式分类器会拦，用户自己在本地终端跑**（`git push -u origin master`）。

## 进度

见 `TASKS.md`，权威进度记录，新会话先读这个文件。
