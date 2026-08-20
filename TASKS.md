# 任务清单

> 这份文件是权威进度记录。任何终端/会话打开这个仓库，先读这份文件再动手。
> 状态只有三种：`[ ]` 待做、`[~]` 进行中、`[x]` 完成。完成的任务顺手写一行结果备注。

## 已完成

- [x] **验证 BNSF 爬虫能否登录并查询** —— 在旧仓库里用真实凭证跑通，登录流程完整走完（用户名 → IdP 选择 → SAML 跳转 → 密码 → 到达查询页）。
- [x] **修复查询提交后的等待逻辑** —— 原来死等 `waitForNavigation` 会超时崩溃（BNSF 现在可能是页面内异步刷新结果，不一定整页跳转）。改成"导航完成"或"结果数据出现"任一个先满足就继续，不再崩溃。用测试箱号 `YMMU6620500` 验证：跑完整链路无异常，返回 "Container not found"（这个箱号本身大概率已失效，不是代码问题）。
- [x] **搭建新精简仓库骨架** —— 本仓库。移植了统一接口(`carriers/base.ts`)+ 修复后的 BNSF 爬虫（`carriers/bnsf/`）+ 延迟/反检测工具（`lib/`）。**移除了旧代码里硬编码的默认账号密码**（安全隐患，已改为强制读 `.env`，缺失就报错，不再有静默兜底）。
- [x] **搭建 Google Cloud 项目 + Sheets/Drive API + 服务账号** —— 项目 `draye-mvp`（个人账号 fallinto2@gmail.com 下，org: fallinto2-org，billing 已挂）。已用 `gcloud` CLI 启用 `sheets.googleapis.com` + `drive.googleapis.com`，创建服务账号 `draye-crawler@draye-mvp.iam.gserviceaccount.com`。**注意：这个 org 有策略禁止下载服务账号 JSON 密钥**（`constraints/iam.disableServiceAccountKeyCreation`，安全默认值，没有绕过，也不需要绕过）——认证方式改用 ADC（见下）。以后迁移到公司账号：新项目重新跑一遍这几条 `gcloud` 命令即可，没有数据要搬。
- [x] **写 `sheets/writer.ts`** —— `src/sheets/writer.ts`，用 `google-auth-library` 默认凭证链（ADC）认证，不依赖任何密钥文件；把 `ContainerResult[]` 覆盖写入 Sheet 的 `Tracking` tab（表头：`container_id | carrier | status | eta_date | eta_time | last_free_day | last_updated`，跟 project_brief.md 里定的契约一致）。代码已写完、`tsc` 类型检查通过，**实际跑没跑通卡在认证 scope，见下**。
- [x] **批量添加 Container 功能** —— Tracking 页面"Add Containers"按钮，`AddContainersModal.tsx`。支持空格/逗号/换行任意混用分隔，大小写不敏感去重（已跟已有记录比对，重复的会跳过并告知）。用真实的 12 个箱号在浏览器里实际测过：正确解析出 12 个、全部加入、状态显示 UNKNOWN（等下一次 Track All 才会真正抓取数据，跟"点 Track All 才抓取"的语义保持一致，没有为新加的箱号单独再造一套立即抓取逻辑）。加入后的箱号目前只存在浏览器内存里（mock 模式），后端接上之后（task #7）会变成真正写入 Sheet。
- [x] **前端 UI 骨架（Dashboard + Tracking）** —— `web/` 目录，Vite + React + Tailwind v4，独立于后端的 `src/`（两边模块系统不同，分开更干净）。移植/简化自旧仓库的 `TrackingModule.tsx`（保留搜索、拖拽排序列、Schedule 定时下拉、Track All 手动触发这几个你点名要的交互）+ `DashboardModule.tsx`（简化成跟这版数据模型对得上的指标：总数/Active/LFD 今天到期/未知）。ETA/LFD 做成了只读展示，没有搬旧版可编辑的日期选择器——这版架构里 Tracking tab 是爬虫自动覆盖写入，客户不手动改，可编辑没有意义。本地看效果：`npm --prefix web run dev`，浏览器打开 `http://localhost:5173`。
- [x] **删除 Container 功能** —— 每行一个垃圾桶图标，**没用原生 `confirm()`**（这个自动化浏览器环境里原生弹窗直接被禁用，而且应用内确认体验也更好）：点一下变成红色"Confirm?"按钮（3 秒内没再点自动取消），再点一下才真的删。浏览器实测过：先点触发确认态，快速点第二下真的从列表和后端数据文件里都删掉了。
- [x] **轻量后端 API（`src/server.ts`）** —— Express，端口 8787，四个接口：`GET /api/tracking`、`POST /api/tracking/containers`（新增）、`DELETE /api/tracking/containers/:id`（删除）、`POST /api/tracking/trigger`（真的跑一次 BNSFCrawler.crawl，抓完写回存储）。**存储先用本地 JSON 文件**（`src/store.ts` → `data/tracking.json`，已加进 `.gitignore`）——Sheets 认证那边还卡着（gcloud 问题），先不卡住"后端能不能真的跑起来"这件事。以后接 Sheets：只需要把 `store.ts` 的 `loadRecords`/`saveRecords` 换成读写 `sheets/writer.ts`，`server.ts` 调用的地方完全不用改。
- [x] **前端接真后端，去掉 mock** —— `useTrackingRecords.ts` 不再有 `USE_MOCK` 分支，全部走 `/api/tracking*`（Vite dev proxy 转发到 8787）。浏览器实测：Add Containers 用真实 12 个箱号测过（正确解析、去重）；Delete 测过（列表和数据文件都正确减少）；Track All 点击后实际触发了后端跑 BNSFCrawler（见下面进行中那条，等结果）。

## 进行中 / 下一步

- [x] **Track All 端到端验证** —— 浏览器里点 Track All，真的触发了后端跑 `BNSFCrawler.crawl()`，抓完写回 `data/tracking.json`，前端自动刷新显示新的 `lastUpdated` 时间戳。整条链路（点击 → 后端 → Playwright → BNSF 真实网站 → 解析 → 写存储 → 前端刷新）验证通过。**注意**：日志显示这次点击触发了两次抓取请求（`[BNSF] Starting login process...` 出现了两遍），目前判断是开发过程中频繁热重载导致的（这次会话改了很多次 TrackingModule.tsx），先记录，不算已确认的 bug，如果之后干净状态下复现"点一次跑两次"，需要再查。
- [x] **换成免登录的 BNSF 移动端接口，彻底解决"查无此箱"问题** —— 真正的根因找到了，两个点都不是账号问题：
  1. **查询箱号要去掉最后一位校验位**（11 位标准箱号 → 10 位设备号）。BNSF 系统认的是不带校验位的号，带校验位提交会报 "invalid"。之前一直以为是登录账号和箱号不匹配，其实是格式问题——用户手动测试截图里箱号"少一位"根本不是输入 bug，是 BNSF 要求的正确格式，我之前理解反了。
  2. **多个箱号之间只能用空格分隔，不能用逗号**——这个页面的输入框有自己的前端逻辑，逗号分隔会把逗号翻倍，导致提交内容错误。
  
  换成 `https://m.bnsf.com/bnsf.was6/dillApp/rprt` 这个免登录移动端接口后：**12 个真实箱号，3.5 秒内全部返回真实 ETA 数据**（对比登录版要 60 秒）。`carriers/bnsf/crawler.ts` 整个重写，不再需要账号密码，`config.ts`/`.env.example` 都同步去掉了账号相关的配置项。曾经尝试过绕过 Playwright 直接发 HTTP 请求（这个页面看起来是普通表单 POST，理论上可行），但会话处理比预期复杂（两个 JSESSIONID 之类），没有花时间深究，用 Playwright 打这个免登录页面已经足够快、足够稳定。
- [ ] **端到端验证：抓取 -> 写入测试 Sheet** —— 卡在认证 scope（`gcloud auth application-default login` 报 `Insufficient Permission`，手动重跑又被 localhost 回调拦了），**用户说先放一放**，不阻塞其他任务。
- [ ] **`Storage Last`（Last Free Day）字段目前查出来都是空的** —— 免登录页面这个字段存在但目前测的几个箱号都没有值，不确定是这几个箱号本来就没有 LFD，还是这个字段需要额外条件才会有值，等有真实需要 LFD 的箱号时再确认
- [ ] **部署到 Cloud Run + Cloud Scheduler**
- [ ] **用真实客户箱号做端到端验证**
- [ ] **清理 UI：隐藏这版用不到的 Dispatch/Invoice/财务卡片** —— 这版 Dashboard 已经是简化版，本来就没有营收/利润卡片，这条基本已经满足，等真的做 Invoice 时再回头看要不要拆分

## 可扩展列 + 详情编辑 + 批量导入 —— 做完之后又被推翻，改成更简单的方案（见下一节）

背景：一开始设想的是"客户提前给一份模板 Sheet 定义列名，系统字段（爬虫拥有只读）+ 客户自定义字段（customFields）"这一整套，包括 Resources（可复用下拉字段）。**这一批全部实现并测过了**（数据模型、`GET/PUT /api/columns`、`PATCH /api/tracking/containers/:id`、Excel 模板下载/导入、详情编辑弹窗、列的增删改），但**用户后来决定不做定制化，改成更简单的版本**——爬虫能抓到什么字段就展示什么字段，客户只能选择显示/隐藏，不需要自定义字段、不需要详情编辑、不需要批量导入。下面这些代码**已经被删除**，不是"以后可能还用得上先留着"：

- ~~`TrackingRecord.customFields` + `ColumnDef.system`~~ —— 改成固定字段集 `KNOWN_COLUMNS`，`ColumnDef` 简化成 `{key, label, visible, order}`
- ~~`PATCH /api/tracking/containers/:id`~~（详情编辑保存用的）—— 删除，详情弹窗整个拿掉了
- ~~`GET /api/tracking/template` + `POST /api/tracking/import`~~（Excel 模板/批量导入）—— 删除，`src/excelTemplate.ts` 整个文件删掉
- ~~`ContainerDetailModal.tsx`~~ —— 整个文件删掉，表格行不再可点击
- ~~`ColumnSettingsModal.tsx` 里"新增自定义列"的输入框 + 每列的删除按钮~~ —— 拿掉，列是固定集合，只能拖拽排序 + 显示/隐藏
- ~~`AddContainersModal.tsx` 的 Bulk Import tab~~ —— 拿掉，只剩粘贴箱号一种加箱号的方式

Onboarding 表格（v1/v2，见下面）里 Custom Columns 那个 Step 3，客户不再需要填了——onboarding 现在只需要公司名 + 用户名密码，表格要不要再简化一次，看用户下次怎么说。

## 简化版：固定字段集，只做显示/隐藏（当前状态，已测）

- [x] **爬虫多抓字段** —— `carriers/bnsf/crawler.ts`，免登录接口返回的字段里，之前只抓了 ETA/LFD，现在把整页能拿到的全部抓出来：Chassis #、Last Hub、Bill Y/N、Lot-Row-Spot、Destination Hub、Locked ETN Date Time、Unit Length。BNSF 有些字段是定长、拿空格补的（比如 `"THENARD   CA"`），也有些空值是 `"- -"` 这种占位符而不是真空字符串，都做了清理（`normalizeEmpty`、内部空格收敛）。用真实箱号验证过：`last_hub: "THENARD CA"`, `bill_yn: "Y"`, `destination_hub: "LOGPARCHI IL"`, `unit_length: "40"` 都正确抓到。
- [x] **数据模型简化** —— `store.ts` 的 `TrackingRecord` 直接把新字段加成一等字段（不再用 customFields 这种嵌套 bag），`KNOWN_COLUMNS` 是权威的固定 14 列定义（7 个原有 + 7 个新加的，新字段默认隐藏，只有 Destination Hub 默认显示）。`PUT /api/columns` 校验改成"提交的列表必须跟 `KNOWN_COLUMNS` 的 key 完全一致，只能改 visible/order"，多一个少一个都拒绝——用 curl 测过：提交只含 1 列会报"缺列"，提交一个不存在的 key 会报"未知列"。
- [x] **前端同步简化** —— 删除 `ContainerDetailModal.tsx`；`ColumnSettingsModal.tsx` 去掉增删列的 UI，只剩拖拽排序 + 显示隐藏；`AddContainersModal.tsx` 去掉 Bulk Import tab；`TrackingModule.tsx` 表格行不再可点击。浏览器实测（真实数据）：把默认隐藏的 "Last Hub" 打开显示，保存后表格立刻多出这一列、正确显示 "THENARD CA"；Add Containers 弹窗确认只剩粘贴箱号 + Rail 选择器。

- [x] **Onboarding 表格 v1**（`docs/onboarding-form.xlsx`）—— 4 个 tab 的版本，客户反馈"不够友好"：多个 tab 割裂、Field Type 概念太抽象、不需要的字段（联系人/邮箱/初始箱号/查询频率）占了篇幅。
- [x] **Onboarding 表格 v2**（`docs/onboarding-form-v2.xlsx`，当前版本，`src/dev/generate-onboarding-form.ts` / `npm run gen:onboarding`）—— 单个 sheet，Step 1/2/3 每步一个色块标题 + 提示文字穿插在对应问题下面。迭代过两轮，都是直接改同一个脚本/同一个输出文件，没有另开新文件名：
  1. 第一轮：合并 4 个 tab 成 1 个；精简掉联系人姓名/邮箱、初始箱号列表、查询频率；"Field Type"抽象概念换成"举个例子" + 单独的 Yes/No"是否可复用"下拉。
  2. 第二轮：行高统一调大（不用客户自己拉）；Company Info 里 username 后面加了 Password 字段（跟 email 无关）；Custom Columns 表格去掉"起始选项值"这一列——可复用列表的具体值客户登录后自己加，onboarding 阶段只需要知道"哪些列可复用"；空白行从 20 加到 40。
  
  这份表填完之后是配置系统的输入，还没做"读这份表自动生成 config"这一步——目前设计是人工读表、手动配置，等真的走过几次 onboarding 之后再看要不要自动化。
- [x] **公司名确认** —— Drayease（用户测试填写时手误打成 Drayesae，已确认）。
- [x] ~~可复用下拉字段（Resources）~~ —— **不做了**，见上面"简化版"那一节，改成固定字段只做显示隐藏，不需要 Resources 这套东西了。

**开发过程中的一个环境教训**：中途多次出现"点按钮没反应"，一开始怀疑是渲染循环之类的真 bug，排查发现是**同一个浏览器 tab 经历太多次代码热重载（HMR）之后，模块状态会损坏**（React 报"Rendered more hooks than previous render"这类错误），不是代码问题。**以后遇到诡异的前端行为，先开一个全新 tab 重试，能排除一大半是不是环境问题，再深挖代码。**

## LFD 颜色预警 + 完成/归档流程 + 列名通用化（当前状态，已测）

- [x] **LFD 颜色预警补回** —— `web/src/components/TrackingModule.tsx` 的 `lfdUrgency()`：LFD 是今天或已过期 → 红色徽章，明天 → 黄色徽章，其他情况不预警。这是简化重写时候真的漏掉的功能（旧仓库原来就有），不是设计决定。日期比较逻辑用 node 脚本单独验证过（昨天/今天/明天/后天/格式错误五种输入，结果都对）；但**目前真实抓到的箱号 LFD 全是空的**（跟 task 里记录的一样，BNSF 免登录页面这个字段还没在真实数据里出现过），所以红/黄徽章在真实环境里还没有肉眼验证过——逻辑本身是对的，等哪天真的抓到一个有 LFD 的箱号，回来确认一下视觉效果。
- [x] **完成/归档流程 + History 页面** —— 完整设计和实现：
  - `TrackingRecord` 加 `completedAt: string | null` 字段（`null` = 还在追踪，非 null = 已完成时间戳）。
  - Complete **不需要二次确认**（单击图标即完成）——设计原则是"容易撤销的操作不需要确认弹窗"，跟 Delete 的两次点击确认（真的会丢数据）区分开。
  - 完成的箱号不删除、不再出现在 Tracking 表格 / Dashboard 统计里，但保留在新的 History 页面（`HistoryModule.tsx`），可以点 Reopen 撤销。
  - `POST /api/tracking/trigger` 现在会跳过已完成的箱号，不再对它们重新发起查询（用 curl 实测过：56 个箱号里标记 1 个完成后，`trigger` 返回 `queried: 55`，完成箱号的 `lastUpdated` 没有变化）。
  - 重新添加一个已完成的箱号（Add Containers 输入同一个箱号）**会自动重新激活**（`completedAt` 清空、挪回 Tracking），不当成"已存在"静默跳过——`POST /api/tracking/containers` 返回 `{added, reactivated}` 两个计数，弹窗里会分别提示。用 curl 实测过整条链路：complete → 重新 add → `{"added":0,"reactivated":1}` → 记录总数没变(没有产生重复行)。
  - 浏览器实测过完整闭环：Tracking 里点 Complete → 该行从 Tracking 消失 → History 里出现，带 Completed 时间戳 → 点 Reopen → History 清空、该行回到 Tracking。
- [x] **列名行业通用术语调整** —— 查了 Union Pacific/BNSF 官方术语表、intermodal.org、BNSF 自己的 API 文档等信息源（不是瞎猜）：
  - 确认 **LFD（Last Free Day）、ETA、Chassis、Ramp/Terminal 这些是行业通用叫法**，当前列名已经在用这些通用词，不用改。
  - `billYN`（原标签 "Bill Y/N"）查到 **BNSF 自己的 API 文档里对应字段叫 `fullBilledIndicator`**（是否已完成计费——集装箱放行前置条件之一），改成更通用的标签 **"Billing Complete"**，不是 BNSF 内部黑话了。只改了展示用的 `label`，内部字段 key 还是 `billYN`（内部实现细节，不是客户看到的东西，没必要跟着大改）。
  - 查过程中还发现一个有价值但**没法直接用**的概念：`Notify`（铁路通知货代"箱子可以来提了"这个事件/时间点），在 UP/BNSF 的术语里是标准概念，理论上是个很有用的字段。但现在爬虫实际抓到的字段里，只有一个来源不明的 `ETN`（当前标签"Locked ETN Date Time"）时间字段有可能对应这个概念——**没有找到权威文档证实 ETN 到底是不是"Estimated Time of Notify"的缩写**，所以没有贸然改名或者包装成"Notify"字段，保持原样，留着这个疑点，以后如果拿到 BNSF 官方文档或者观察到足够多真实数据能反推它的含义，再回来改。
  - **没有删除任何现有列**——逐个评估了一遍，`unitLength`（Unit Length）看起来是最不像"追踪事件"的一个（更像集装箱的静态属性），但它仍然是个通用、客户可能用得上的字段，没有找到"不通用且没用"的实锤，所以没删。

## History 并入 Tracking + 登录系统 + 文案打磨（当前状态，已测）

- [x] **History 从独立导航项改成 Tracking 页面内的切换** —— 去掉左侧导航栏的 History，`HistoryModule.tsx` 整个文件删掉，逻辑合并进 `TrackingModule.tsx`：页面里加了个 "Active (N) / History (N)" 切换 pill，两个数字实时反映当前箱号数。History 模式下 Add Containers / Track All / Schedule 这几个只对"在追踪的箱号"有意义的按钮会隐藏，Columns 按钮两边都保留（列配置是全局的）；表格复用同一套 `renderTrackingCell`，History 模式多一列 "Completed" 时间戳，操作按钮从 Complete+Delete 换成 Reopen。浏览器实测过切换、空状态文案、真实 Complete → 出现在 History → Reopen → 回到 Active 的完整链路。
- [x] **登录页 + 单账号系统**（从无到有的新功能，不是复用旧仓库的 Supabase 登录）：
  - 后端 `src/auth.ts`：账号信息存 `data/account.json`（`companyName` + `username` + `password`，明文——跟 `tracking.json`/`columns.json` 一样是"临时本地存储，以后换成客户自己的存储"这套模式,不是最终方案）。Session 用内存里的 token 集合 + httpOnly cookie 实现，没引入 JWT 或者第三方 session 库——单账号单机部署不需要那么重。服务重启会清空所有 session（等于强制重新登录），可接受。
  - 新接口：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/session`；`/api/tracking*` 和 `/api/columns*` 全部挂了鉴权中间件，没登录一律 401。
  - 前端 `useAuth.ts` + `LoginPage.tsx`（改自旧仓库 `custom/components/LoginPage.tsx` 的视觉设计，但认证字段从 Email 换成 Username——这版是"一个客户一个共享账号"，不是 Supabase 那种每个人一个邮箱注册的模式，也去掉了 Remember me / Forgot password / Request access 这些不适用的功能）。
  - 登录后左上角品牌区从写死的 "Draye" 改成显示 `companyName`（下面配一行小字 "Powered by Draye"），侧边栏底部加了 Log out。
  - 用 `curl` 测过完整后端链路（未登录 401、错密码 401、正确登录拿到 cookie、cookie 能访问 `/api/tracking`、logout 之后 cookie 失效),浏览器里也测过一遍完整流程(错密码报错 → 正确登录 → 看到侧边栏 "Newgen" → Tracking/History 都能正常读写 → Log out → 回到登录页)。测试账号：公司 Newgen,用户名 admin,密码 hermes(存在 `data/account.json`,这个文件在 `.gitignore` 里,不会进版本库)。
- [x] **UI 文案打磨** —— 找旧仓库 `Saasworkflowautomationapp` 的 `TrackingModule.tsx`/`DashboardModule.tsx` 当参考,把几处不够好的文案换掉:
  - Tracking 页副标题 "BNSF container tracking, refreshed automatically" → 改成 "All your containers, tracked automatically — no manual lookups."(更通顺,也不会因为以后加新 carrier 而显得文案过时)。
  - 空状态文案原来只有一句"No containers found.",现在按情况区分:完全没有箱号 vs 搜索没匹配 vs History 里还没有完成的箱号,三种情况文案都不一样。
  - Columns 弹窗副标题从"These are all the fields we can pull from BNSF."改成"Drag to reorder. Choose which fields show in the table."——原来的写法绑死了 BNSF,不通用。
  - 登录页副标题:"Container tracking, on autopilot"。
- [x] **对比旧仓库 UI,评估保留哪些元素** —— 读了旧仓库完整的 `TrackingModule.tsx`(1490 行)和 `DashboardModule.tsx`,逐项对比:
  - 保留/延续的模式:点表头排序、Schedule 定时下拉、Track All 手动触发、搜索框、拖拽排序列设置面板、"点一下进入确认态再点一下才真删"这套删除交互——这些这版本来就有,继续保留。
  - 新增的 Active/History 切换 pill,是这版自己的设计,不是从旧仓库搬的(旧仓库没有 Complete/History 这个概念)。
  - **没有搬的东西,及为什么**:旧版 Tracking 页头部自己还有一套 Total/Active/Grounded/Inactive 统计卡片(跟 Dashboard 重复)——这版没加回来,因为现在的 Active/History pill 已经承担了同样的"一眼看到数量"的作用,再加一套卡片是重复信息、占地方。旧版有分页(50 条/页)——这版数据量还小(几十条),排序+搜索够用,没有为了"保留原有"硬套一个当前用不上的分页控件。WelcomeBanner 原来背景是一张 Unsplash 图 + 深色蒙层,这版简化成纯渐变色——没有恢复,因为外链图片是个不必要的外部依赖(链接可能失效),纯渐变已经足够好看,不算功能性损失。

## 三个小问题修复（当前状态，已测）

- [x] **修了一个真的排序 bug** —— 点表头排第一次是升序,第二次点(该切降序)完全没反应,图标也不变。根因是 `handleSort` 里在 `setSortBy` 的 updater 函数内部又调了一次 `setSortDir`(嵌套 setState 副作用)——React 为了判断"新值跟旧值是否相同"这个优化,会把 updater 函数多调用一次,藏在里面的 `setSortDir` 也跟着被多触发一次,一次切换 + 一次多余的切换 = 等于没切换,点第二下才会复现。改成不用嵌套 setState、不用 `useCallback`(这个 handler 只在本文件内联绑定,不需要跨渲染保持引用稳定),直接读当前 state 判断。用脚本模拟点击三次验证过:第一下升序(图标 ChevronUp,顺序变化)、第二下降序(图标变 ChevronDown,顺序反过来)、第三下变回升序——三次结果都对。
- [x] **"Powered by" 品牌角标挪到右上角 + 文案改成 Drayease** —— 原来是侧边栏公司名下面一行小字"Powered by Draye",现在挪到整个页面右上角(`fixed` 定位,所有 tab 通用,不随页面滚动),文案改成"Powered by Drayease"。
- [x] **Dashboard 欢迎语从"Welcome back, {username}"改成按时段问候 + 公司名** —— 原来写死"Welcome back, admin."(用户名是 admin,不专业也没有公司信息)。改成 `Good morning/afternoon/evening, {companyName}.`(根据当前时间自动换,比固定的"Welcome back"更像真人写的,不是模板感)。`WelcomeBanner`/`DashboardModule` 的 prop 从 `userName` 换成了 `companyName`。

## 两个小调整（当前状态，已测）

- [x] **"Powered by Drayease" 挪回侧边栏**，还是放在公司名（"Newgen"）下面那行小字——上一轮改成了页面右上角固定角标，用户看完觉得原来的位置更好，改回去了。
- [x] **Dashboard 加了"Tracking"小标题** —— 那四张卡片（Total/Active/LFD Today/Unknown）都是 tracking 相关的指标，用户希望客户一眼能看出这几张卡片是"Tracking"这个模块的，不是笼统的公司整体数据。加在欢迎语和卡片之间，一行小号大写字，不占地方。

## 存储正式切到 Google Sheets（当前状态，已测）

之前一直卡在 gcloud 认证 scope 问题，这次真正解决了——根因不是 scope 参数写错，是 **gcloud 自带的共享 OAuth 客户端对 Sheets/Drive 这类"敏感"scope 没有走完 Google 的验证流程，Google 直接整个拒绝**（不是显示"未验证应用"警告页那种可以点"继续"的拒绝，是硬拒绝）。解法：自己在 Cloud Console 建一个 OAuth 客户端（Desktop app 类型，OAuth 同意屏幕设成"外部+测试"、把自己的账号加进测试用户），用 `--client-id-file` 指向这个自建客户端再跑 `gcloud auth application-default login`，这样走的是自己的 App，Google 只会弹"未验证应用"警告（可以点 Advanced 继续），不会硬拒绝。

- [x] **`git init` 的仓库第一次提交 + 配置好 push** —— 41 个文件，`secrets/` 提前加进 `.gitignore`（当时是空文件，但目录名叫 secrets 就不该有机会被跟踪进去）。`git push` 被这个环境的自动模式分类器挡了（跟之前 gcloud auth 命令一样的限制），用户自己在本地终端跑的。
- [x] **建了正式的存储用 Google Sheet**（`src/dev/setup-sheet.ts`，一次性脚本）—— 一个 Sheet 三个 tab：`Tracking`/`Columns`/`Account`，各自带表头。Sheet ID 存在 `.env` 的 `SHEET_ID`。
- [x] **`store.ts` 从本地 JSON 文件改成读写这个 Sheet** —— `sheets/client.ts` 提供通用的 `readRows`/`overwriteRows`（先 clear 再 update，避免行数变少留脏数据；写用 `RAW` 模式不触发 Sheets 自动类型转换，比如箱号里的日期字符串"08/17/26"不会被误判成真的日期类型；读用 `UNFORMATTED_VALUE` 保证布尔/数字读回来是原始类型不是字符串）。老的 `sheets/writer.ts`（只支持 7 个字段的窄 schema，早期写的，一直没真正接入 server.ts）整个删掉，被这次的新实现取代。
- [x] **`auth.ts` 的账号信息也从本地文件改成读 Sheet 的 Account tab** —— 这是这次真正要解决的问题：之前登录账号存在本地 JSON 里，部署到 Cloud Run 后容器一重启文件就没了，密码会被重置成默认值。现在账号跟 tracking/columns 数据一样在 Sheet 里，不会因为重新部署/冷启动丢失。
- [x] **把本地测试数据搬进新 Sheet**（`src/dev/migrate-local-to-sheet.ts`，一次性脚本，跑完可以删）—— 56 个真实箱号记录、14 个列配置（含用户自己调过的显示/隐藏）、Newgen/admin/hermes 测试账号，全部原样搬过去，没有丢数据。
- [x] **端到端验证过**：curl 测过登录/读 tracking/读 columns/reopen 写操作，浏览器里也登录看过 Dashboard，数据跟本地版一致（56 个箱号、18 active、1 个 LFD today）。

## 部署到 Cloud Run + Cloud Scheduler（当前状态，线上已跑通）

- [x] **正式部署**——服务地址 `https://draye-mvp-373319016662.us-central1.run.app`，跑在 `draye-crawler` 服务账号上，2Gi 内存，300s 超时（batch 抓取需要时间，超时给够）。单个 Cloud Run 服务同时 serve 前端静态文件和 `/api/*`，没有另外起前端托管——`server.ts` 在所有 API 路由之后加了 `express.static` + SPA fallback，只有 `web/dist` 存在时才会命中这条路径，本地开发（Vite 自己起 5173）不受影响。
- [x] **Dockerfile**——三段式构建：前端(Vite build)、后端(tsc build)、运行时用 Microsoft 官方 Playwright 镜像（`mcr.microsoft.com/playwright:v1.62.1-noble`，tag 必须跟 `npm ls playwright` 解析出的版本对上）,浏览器/系统依赖都已经装好,不需要额外跑 `playwright install`。
- [x] **Cloud Scheduler 定时任务**（`draye-track-all`，每 6 小时跑一次 `POST /api/tracking/trigger`）——问题：这个接口原来要求登录 session cookie,定时任务没有浏览器 session 走不通。解法：`requireAuth` 中间件加了个口子,配了 `SCHEDULER_SECRET` 环境变量的话,请求带对 `X-Scheduler-Secret` header 就放行,不用 session。本地不配这个环境变量就完全没这个后门,不影响正常登录鉴权。
- [x] **线上端到端验证过**（不是只测通了部署,是真的测过完整链路）：登录、读数据、手动触发 Track All（Playwright 在容器里真的跑起来了,56 个箱号全部抓取成功,结果写回 Sheet）、Cloud Scheduler 手动触发一次也验证过完整走了一遍（日志里看到 `Google-Cloud-Scheduler` 的请求打到服务上,返回 200,数据时间戳也刷新了）。

**部署过程踩的坑**（都已解决,记录下来避免下次重复排查）：
- `.gitignore` 里 `*.html` 写得太宽,把 `web/index.html` 也一起排除了,导致 Cloud Build 打包源码时漏掉这个文件,前端编译报"找不到入口"——改成只匹配 `debug-*.html`/`debug-*.png` 这种更精确的命名。
- 本机 `gcloud` CLI 装的 Python 是 3.9,新版 `gcloud run deploy` 命令模块用了 3.9 不支持的语法,直接崩溃加载不了——用 `CLOUDSDK_PYTHON` 环境变量指向机器上装好的 Python 3.11 就解决了。
- 项目默认的 Compute 服务账号（Cloud Build 用它跑构建）缺两个 IAM 权限：读取上传到 GCS 的源码包（`roles/storage.objectViewer`）、推送镜像到 Artifact Registry（`roles/artifactregistry.writer`）——新项目这两个权限不是默认就有的,手动补上了。
- Cloud Scheduler 任务刚创建完立刻手动触发,请求没有真的发出去（日志也没有报错）,等了一分多钟再触发一次就正常了——像是新建任务有个生效延迟,不是配置问题。

## 定时任务改成真的服务器端可控（当前状态，已测）

发现了一个**真的 bug**，不是新需求：界面上 Tracking 页那个 Schedule 下拉菜单（1/3/6/8 小时）一直是从旧仓库直接搬过来的浏览器 `setInterval` 实现——只有那个浏览器标签页开着才会跑，关掉标签页、合上电脑，定时查询就完全停了。客户会以为"设置好了就自动跑"，实际上不是，这个必须在真正接客户之前修，用户明确要求了。

- [x] **`src/scheduler.ts`** —— 用 `googleapis` 包自带的 `cloudscheduler` v1 客户端（不用额外装新依赖，`sheets`/`drive` 也是这个包提供的，风格统一），直接读写部署时创建的那个 Cloud Scheduler 任务（`draye-track-all`）的 cron 表达式和启用/暂停状态。认证跟 Sheets 那套一样走 ADC。
- [x] **新增 `GET/PUT/DELETE /api/schedule`** —— 客户在界面上选 1/2/4/8 小时，实际改的是云端那个定时任务的 cron 表达式（`0 */N * * *`），不是本地状态。`PUT` 只接受 1/2/4/8，其他值直接拒绝。
- [x] **服务账号加了 `roles/cloudscheduler.admin`** —— `draye-crawler` 这个服务账号原来只有权限跑爬虫、读写 Sheet，现在还需要能改 Cloud Scheduler 任务的配置。
- [x] **前端去掉 `setInterval`/`localStorage` 那套** —— `TrackingModule.tsx` 的 Schedule 相关状态全部改成从 `useSchedule.ts`（新 hook）读服务器真实状态，选项从 `[1,3,6,8]` 改成用户要求的 `[1,2,4,8]`。
- [x] **端到端测试过，不是只测通接口**：本地浏览器里点"Every 1 hour"，直接用 `gcloud scheduler jobs describe` 确认云端任务的 cron 真的变成了 `0 */1 * * *`；点"Stop Schedule"，确认任务状态变成 `PAUSED`。两边都对得上，不是界面自己骗自己。

## 监控报警 + 一键开通客户脚本（当前状态，已测）

- [x] **监控报警** —— Cloud Monitoring，一个邮箱通知渠道（发到 fallinto2@gmail.com，以后换公司邮箱直接改这个渠道就行）+ 三条报警规则：
  1. **服务整体连不上**（uptime check，每 5 分钟从外部探测一次首页，连续失败触发）
  2. **Cloud Run 返回 5xx**（请求错误率异常）
  3. **爬虫失败率过高**（应用层信号——`server.ts` 的 `/api/tracking/trigger` 现在会算"非'查无此箱'原因导致的失败"占比，超过 20% 就打一行 `[ALERT]` 开头的日志，Cloud Monitoring 用日志匹配规则抓这行日志触发报警。区分"箱号本身没查到"和"爬虫真的坏了"很重要——前者是正常业务情况，天天都有，不该报警）
  
  三条规则和通知渠道都用 `gcloud alpha monitoring` 系列命令建的（第一次用需要装 `gcloud components install alpha`）。**如实说明测试程度**：规则配置本身核对过（`gcloud alpha monitoring policies list` 确认三条都 enabled、都关联到正确的通知渠道），但没有真的制造一次故障去验证邮件确实发得出来——不想为了测试真的把服务弄挂或者伪造大量抓取失败。如果想更放心，可以手动跑 `gcloud alpha monitoring policies test` 或者真等一次意外发生时确认。
- [x] **一键开通客户脚本**（`scripts/onboard-customer.ps1` + `src/dev/provision-sheet.ts`）—— 把之前手动跑的一整套 gcloud 命令（建 Sheet、写入账号、分享给服务账号、部署 Cloud Run、建 Scheduler 任务）打包成一条命令：
  ```powershell
  .\scripts\onboard-customer.ps1 -CompanyName "客户公司名" -Username admin -Password xxxx -ScheduleHours 4
  ```
  当前架构是"一个客户一套部署"（独立 Sheet + 独立 Cloud Run 服务 + 独立 Scheduler 任务），公司名会转成 slug 作为服务名/任务名的一部分。**真的端到端测试过，不是只测了语法**：用一个假客户"Test Onboard Co"完整跑了一遍——建 Sheet、部署服务、建定时任务、登录验证账号密码正确，全部成功之后把这些测试资源（Cloud Run 服务、Scheduler 任务、两个测试 Sheet）都删掉/清理了，不会留在项目里当垃圾。过程中还真的抓到一个 bug 并修了：PowerShell 脚本开头设了 `$ErrorActionPreference = "Stop"`，检查"定时任务是否已存在"这一步用 `gcloud scheduler jobs describe` 在任务不存在时会返回非零退出码，这个设置会把这种预期内的失败也升级成终止错误，脚本直接跑挂——改成 `try/catch` 接住就好了。

## 真实使用反馈修复批次（当前状态，已测，来自客户实际用数据后的反馈）

客户已经在真实用这套系统了（Sheet 里已经有 200+ 个真实箱号，不是测试数据），下面这批是根据真实使用反馈来的：

- [x] **加回 GROUNDED 状态** —— 之前 `TrackingRecord.status` 的类型定义里一直有 `GROUNDED`、UI 颜色也早就配好了（红色），但 `server.ts` 的抓取结果映射逻辑压根没有任何路径会赋值成 `GROUNDED`，一直是漏掉的。现在逻辑是：`Lot-Row-Spot` 有值（箱子已经卸到场内具体堆位了）→ `GROUNDED`，优先级在"有没有 ETA"前面，因为这是比 ETA 更直接的"箱子已落地"信号。用客户真实的 204 个箱号验证过：跑一次 Track All，73 个正确变成 GROUNDED，样本数据（`lotRowSpot: "D - 63 - 15"`）跟状态对得上。
- [x] **排查"Lot-Row-Spot 没抓到"反馈，结论：其实抓到了，只是默认隐藏** —— 写了个脚本直接扒 BNSF 页面原始 HTML 确认真实 DOM 结构：`id="Lot-Row-Spot"`，跟爬虫代码里已经在用的选择器完全一致；又跑了一次真实爬虫在这个具体箱号（客户反馈里的 FSCU891133）上验证，`lot_row_spot: "S - 532 - 14"` 正确抓到——**这个字段从"多抓字段"那一批（task #22）开始就一直在正常工作，没有 bug**。真正的问题是 `KNOWN_COLUMNS` 里这一列默认 `visible: false`，客户没在 Columns 面板里手动打开过，以为没抓到。现在改成默认 `visible: true`（毕竟现在也跟 GROUNDED 状态挂钩了，客户会想看），线上已有的 Sheet 也同步改过，不用客户自己去 Columns 面板手动开。
- [x] **排序把空值排到最后，不管升序降序** —— 客户反馈点"按 ETA 排序"看到的都是没有 ETA 的空箱号排最前面，最该关注的"快到期的箱子"要往下翻才看得到。`TrackingModule.tsx` 的排序逻辑加了一个前置判断：两边都是空值 → 相等；只有一边空 → 空的那个排后面，这个判断在决定用 asc 还是 desc 之前就生效，所以升序降序结果里空值都在最后。`lastUpdated` 这个用时间戳数字比较的字段也做了同样处理（原来空值当成 epoch 0，会被排到升序最前面）。真机验证过：204 条真实数据升序点一次、降序点一次，两次结果空值（显示"-"）都在最后 5 行，日期数据都在最前面。
- [x] **回答了"有没有压力测试过 BNSF、会不会被封"的问题** —— 如实说明：没有主动做过压力测试，也不建议为了摸阈值故意打人家生产站点。现有的保护措施：批量查询限制在 50 个一批（`BNSF_BATCH_SIZE`）+ 批次间 1-2 秒随机延迟。**记录一个真实的架构风险，不是现在要解决，但要记住**：现在是"一个客户一套独立部署"，各自按自己的频率打 BNSF，互相不知道对方的存在——客户数量上来之后，即使单个客户频率不激进，BNSF 那边看到的可能是从同一批 Google Cloud IP 段来的、聚合起来偏密集的请求，被限流/封锁的风险会实际增高，而且现在没有任何"全局节流"机制去控制所有客户加起来对 BNSF 的总请求量。如果真的开始接多个客户，这是需要认真设计的一块（比如一个跨客户共享的请求队列/节流层），不是简单加个延迟能解决的。已有的"爬虫失败率过高"报警规则（见上面监控报警那节）是目前唯一的"万一被封了会不会知道"的兜底——会发邮件，不是等客户投诉才发现。

- [x] **列开多了表格被裁掉一截，不是不显示只是滚不到** —— 客户截图反馈"选多了显示不全"（当时开了 13+ 列，右边的字段包括 Last Updated 都看不见）。根因：`TrackingModule.tsx` 表格外层的容器是 `overflow-hidden`，列一多、表格比容器宽的时候，超出去的部分直接被裁掉，没有滚动条。改成表格单独套一层 `overflow-x-auto`，外层的 `overflow-hidden` 只留着裁圆角。用客户真实开着的 15 列布局验证过：`scrollWidth` 1804px vs `clientWidth` 975px，确实需要横向滚动；滚到底之后 `Last Updated` 这种之前被裁掉的列能正常看到了。

## 批量勾选 + 批量完成/删除（当前状态，已测）

- [x] **Tracking 表格加了多选** —— Active 视图每行前面一个勾选框 + 表头一个全选框（全选操作的是当前搜索筛选之后看得见的这些行，不是全部箱号）。选中之后表格上方弹出一条操作栏，显示"N selected"，带 Complete / Delete 两个按钮。Batch Complete 不需要二次确认（跟单条一样，能在 History 里撤销）；Batch Delete 跟单条删除一样要点一下进入"Confirm delete?"确认态，3 秒内没再点自动取消。
- [x] **后端专门开了批量接口，不是循环调单条接口** —— `POST /api/tracking/containers/batch-delete`、`POST /api/tracking/containers/batch-complete`，一次请求里读一次、把所有选中的箱号都改完、存一次。这是有意的设计,不是偷懒:如果批量操作靠前端循环调 N 次单条接口（单条接口本身是"读全部→改一条→存全部"），并发的 N 个请求会各自读到同一份旧快照,后写的会把先写的覆盖掉,批量删 5 个可能只真的删掉 1 个。
- [x] **真的端到端测过，不是只看了代码**：用真实客户账号 + 假的测试箱号（不碰真实 201 条客户数据）跑了三轮——全选+批量删除的"点一次武装、点第二次确认"两步流程（3 秒窗口内两次点击，通过后端 curl 确认真的从 Sheet 里删掉了）、批量完成（确认箱号正确出现在 History,带时间戳）、全选/取消全选在当前搜索结果范围内正确切换。测完把所有测试数据清理干净了，客户数据始终是 201 条没变过。

## 表格滚动条要滚到页面最底部才摸得到（当前状态，已测）

客户截图反馈：横向滚动条得先把 200 多行的表格滚到最底下才看得到，问是不是该做分页。评估后判断分页对这个量级（~200 行）没必要，反而增加交互复杂度，选择直接修滚动容器结构。

根因：上一批修复（见上面"列开多了表格被裁掉一截"）给表格套了 `overflow-x-auto`，解决了"裁掉看不见"的问题，但那层容器高度不受限——200+ 行的表格把容器撑得很高，横向滚动条跟着渲染在表格最底部，用户得先把整个页面滚到底才摸得到，体验上跟没修一样。

- [x] **改成单一容器管两个方向的滚动，高度锁定在可视区域** —— `TrackingModule.tsx`：外层内容区（原来 `flex-1 overflow-auto`）改成 `flex-1 min-h-0 overflow-hidden flex flex-col`，批量操作栏加 `flex-shrink-0`；表格外层卡片和内层滚动容器都改成 `flex-1 min-h-0`，内层滚动容器（套着 `<table>` 那层）用 `flex-1 min-h-0 overflow-auto` 同时接管横向和纵向滚动——它的高度被外层 flex 布局卡死在可视区域内，不会因为行数多就跟着表格一起变高。顺带给 `<thead>` 加了 `sticky top-0`，往下滚的时候列名一直看得见。
- [x] **端到端验证过，不是只 `tsc` 过关**：浏览器里用客户真实账号（15 列布局，跟客户截图对得上）实测——滚动容器 `clientHeight` 646px（锁死在可视区域内，跟表格真实 `scrollHeight` 10701px 完全脱钩）；把这个容器纵向滚到底（`scrollTop = 5000`）前后，它的 `getBoundingClientRect().bottom` 都是 867px，没有随内容变化,说明横向滚动条的位置固定贴在可视区域底部，不需要先滚完整页;`<thead>` 确认是 `position: sticky`、`top: 0`，纵向滚动时表头没跟着滚走。
- [x] **部署到生产环境** —— 提交 commit `6c86c65`，`gcloud run deploy` 到 `draye-mvp` 服务。

## 数据备份（当前状态，已测）

客户明确问过"数据存哪、丢了怎么办"，讨论后决定：主存储继续按方案 B 留在我们这边（不是客户自己的 Google Drive），但加一层我们自己控制、跟主 Sheet 完全独立的自动备份——这是行业里 SaaS 存储的标准做法，不是新架构。

- [x] **`src/backup.ts`** —— 用 `googleapis` 包自带的 `storage` v1 客户端（跟 `scheduler.ts` 一样的思路，不装新依赖），把每次写入 Sheet 的原始行数据（跟 `sheets/client.ts` 的 rows 格式完全一致，不是解析后的业务对象，方便真出事时原样写回去恢复）快照成一份 JSON，写到 Cloud Storage bucket `draye-mvp-backups`。对象路径 `{SHEET_ID}/{tab}/{timestamp}.json`——一个 bucket 服务所有客户部署，靠 SHEET_ID 天然分区不会互相覆盖，`onboard-customer.ps1` 不用改。
- [x] **接入点在 `store.ts` 的 `saveRecords`/`saveColumns`**，不是每个 API 端点单独调——这两个函数是所有写入 Sheet 的唯一出口（跟批量接口"一次读改存"是同一个原则），改这一处就覆盖了所有会改数据的操作。
- [x] **fire-and-forget，不阻塞主流程**——`void backupTab(...)`，不 await。备份失败不能让客户点 Track All / 加箱号卡住或报错；`backup.ts` 自己吞掉错误，打一行 `[ALERT]` 日志——这个前缀复用了已有的 Cloud Monitoring 日志报警规则（广泛匹配 `[ALERT]`，不是只认爬虫失败那一种消息），不用为备份单独建报警规则。
- [x] **Cloud Storage 基础设施**：bucket `draye-mvp-backups`（us-central1，uniform bucket-level access）+ 90 天自动过期的 lifecycle 规则（避免无限增长，反正 90 天前的快照实用性也低）+ `draye-crawler` 服务账号只给了 `roles/storage.objectCreator`（最小权限——只能写新对象，不能读/删/覆盖已有备份，删除交给 lifecycle 规则）。
- [x] **端到端测过，不是只看代码**：本地起后端，用一个假箱号（`BKUPTEST0001`，不碰真实数据）触发一次 add，`gcloud storage ls` 确认真的在 bucket 里生成了对应 SHEET_ID/Tracking 路径下的快照文件，下载下来确认内容是 212 行原始数据（211 条真实客户数据 + 1 条刚加的测试箱号），格式跟 Sheet 里的行完全对得上；测完把测试箱号删掉，真实客户数据没受影响。
- [x] **已知的取舍，不是遗漏**：`Account` tab（公司名/账号/密码）没有接入自动备份——这个 tab 目前没有任何 API 会写它（只在客户开通时写一次），丢失风险极低，真要恢复也就是重新填一次账号信息，为它加一整套备份触发点性价比不高。如果以后 Account 也能被 API 修改（比如客户能自己改密码），再补上。

## 第一次真实报警：抓取失败会冲掉客户已有数据（当前状态，已修已测）

2026-08-18 12:01 UTC 收到监控邮件报警（`Draye - Crawl failure alert`）——**这是报警系统第一次真的发挥作用，证明它是通的，不是摆设**（之前一直老实说"配置核对过但没真的触发过"）。

**排查结论，先说最重要的：爬虫没坏，BNSF 也没封我们。** 一开始看数据分布（0 个 ACTIVE、0 个 GROUNDED、130 UNKNOWN）以为是大面积故障，这个判断是错的——用真实箱号在本地跑了一次爬虫验证：BNSF 正常返回数据（`last_hub: "THENARD CA"`、`destination_hub: "LOGPARCHI IL"`、`bill_yn: "Y"`），这批箱号只是**本身还没有 ETA**（还在西海岸，没发往芝加哥）。`UNKNOWN` 这个状态同时代表"没查到"和"查到了但还没 ETA"两种情况，光看状态分布会误判。核对备份快照确认：每次抓取 180 个箱号都有数据回来，不存在抓不到的问题。

**真正的问题（是个真 bug）**：4 个批次里第 3 批提交后 30 秒没响应（`page.waitForNavigation: Timeout 30000ms exceeded`），那 50 个箱号被写成 `status: ERROR`，并且 **Last Hub / Destination / Billing 这些上一轮明明抓对了的字段全被 null 覆盖**。一次网络抖动就把客户已有的真实数据毁掉，这个不能接受。频率：7 天 25 次抓取里出现 1 次（约 4%），是偶发不是常态。

- [x] **失败时不覆盖好数据** —— `server.ts`：抓取结果是"真错误"（不是"查无此箱"）时直接 `return r`，原样保留上一次的记录。`lastUpdated` 也故意不更新——表格上那一列停在旧时间，本身就是"这条没刷新成功"的诚实信号，比显示一行空数据 + ERROR 有用。
- [x] **整批失败重试一次** —— `crawler.ts`：一批里所有箱号都因"非查无此箱"原因失败 = 这批的提交/跳转本身挂了，等 3-5 秒重试一次。只重试整批失败的情况——个别箱号查不到是正常业务情况，重试没意义。
- [x] **没有把警报捂掉** —— 失败率报警照常触发，我们该知道还是会知道；这次改的只是"失败之后不要连累客户数据"。
- [x] **真的复现着测的，不是改完看类型过了就算**：新开了一张一次性测试表（不碰客户那 211 条真实数据），加两个真实箱号 → 跑一次真抓取拿到真实数据 → 用 `BNSF_NAVIGATION_TIMEOUT=1` 强制复现完全一样的超时失败 → 确认三件事：日志里确实失败了并且重试了、`[ALERT]` 照常打出来、**数据完好无损且 `lastUpdated` 停在旧时间戳**。测完把测试表和它产生的备份快照都清理干净了。
- [x] **备份系统顺带被验证了** —— 排查时直接用前一天刚做的 Cloud Storage 快照做时间线对比（00:00 / 04:00 / 08:00 / 12:01 四个时间点的状态分布），这是判断"是不是一直坏着"的关键证据。备份第一次派上用场就是在真实排查里。

## 客户反馈第二批：前导零 + shift 多选/多列排序 + OUTGATED 生命周期 + 批量提速进度条（2026-08-19，已测已部署）

来自客户实际使用后的反馈，一批做完：

- [x] **BNSF 前导零** —— 去校验位之后，数字段的前导零也要全去掉（`BEAU0274496`→`BEAU27449`、`BEAU0000095`→`BEAU9`）。`crawler.ts` 的 `stripCheckDigit` 用 `parseInt` 去零；结果解析处对返回的 `unitNumber` 同样归一化，否则对不回原始箱号。
- [x] **shift 范围多选** —— 像 Windows 资源管理器：点第一个、按住 shift 点第十个，中间全选（按当前排序顺序算区间）。**修了上一版引入的 bug**：之前用 `onClick+preventDefault` 拦原生勾选，破坏了受控 checkbox 的对勾刷新（选中了但不显示勾）；改成 onClick 只把 shiftKey 记进 ref、切换交给原生 onChange。本地 150 行真实数据验证：点第1行→shift点第4行→1-4 全打勾、显示"4 selected"。
- [x] **多列排序** —— 单击列头替换排序（同列切方向）；**shift+单击**追加次级排序、可无限叠加，已在栈里的列则切方向；列头显示优先级序号。典型用法：先按 Status 把 Grounded 排前，再 shift 按 LFD → grounded 里 LFD 早的浮顶。
- [x] **OUTGATED 生命周期 + 自动归档** —— `ACTIVE(有ETA)→GROUNDED(有堆位)`，若 GROUNDED 箱子下一轮**彻底查不到**则判定已提离场站，标 `OUTGATED`、自动 `completedAt` 归档进 History、不再抓取。区分好：仍能查到但丢了堆位只是变 `UNKNOWN`，不是 OUTGATED。抓取更新跳过所有已完成记录，历史存档永不被回写。
- [x] **同号双记录 + 行操作按 id** —— OUTGATED 存档留 History；同号再 add 新建记录不 reopen 存档（人工 dispatch 的仍走 reopen）。由此同号可能两条记录，删除/完成/reopen/批量全部改为按记录 id（`/api/tracking/records/:id`），不再按箱号，避免误伤另一条。
- [x] **DLL 一次上限实测 = 100** —— 拿真实箱号实测：100 正常，105/110/120/150 页面**静默返回空**（全"查无此箱"不报错）。默认批量 50→**90**（留余量不贴硬边界，200 以内 90/100 分批数一样）。护栏：整批全"查无此箱"重贴成真实错误当查询失败处理，触发重试+保留旧数据+报警，且不会误触发 OUTGATED 归档。
- [x] **Track All 实时进度条** —— `/trigger?stream=1` 流式返回 NDJSON，每抓完一批推一行累计进度（批次 x/y、n/总数、found/notFound/error）；定时任务仍走原 JSON+状态码路径；核心逻辑抽 `runCrawlAndSave` 两路共用。前端边读流边更新，抓取中表格上方显示进度条。150 个真实箱号验证：2 批跑完、数据刷新、0 误归档、无报错。
- [x] **已部署** —— revision `draye-mvp-00011-ppr`，生产冒烟测试通过。

## 客户反馈第三批：完成即 OUTGATED + 表格性能 + 锁功能入口 + 账号套餐（2026-08-19，已测已部署 00012）

- [x] **手动完成也标 OUTGATED** —— 人工点完成/批量完成的记录状态也置 OUTGATED，跟自动判定的归档
  语义统一，History 里统一显示。Reopen 时若原状态是 OUTGATED 则回到 UNKNOWN（等下次抓取重判）。
- [x] **表格排序/滚动性能** —— 实测 248 行、约 4000 单元格。行抽成 `React.memo`（props 全稳定引用，
  排序只重排、行跳过重渲染；勾选只重渲染该行）；区间选择锚点改 id（跨排序有效、行不接收会变的 idx）；
  visibleColumns/filtered/sorted 用 useMemo；行加 `content-visibility:auto`（跳过屏幕外行绘制，滚动更跟手，
  列宽实测稳定）+ 去掉逐行过渡动画。**注意**：248 行且增长中，排序的重排绘制仍有固有成本，
  彻底流畅需要**虚拟化（只渲染可见 ~30 行）**——这是下一个专门任务，要兼容 sticky 表头 + 横向滚动 + 滚动容器。
- [x] **锁住的 Dispatch / Invoices 入口** —— 侧栏加两个锁住的导航，点击弹"coming soon"提示、不跳转。
- [x] **账号套餐（额度/档位）** —— 见 CLAUDE.md "账号套餐"。每日 Track All 上限 + 解锁的 schedule 档位，
  存 Account tab（每客户一套），环境变量可覆盖用于测试。手动超限 429、定时不受限。界面显示"N/5 left today"、
  未解锁档位锁住带升级提示。开账号时 `-MaxTrackAllPerDay 5 -AllowedScheduleHours "8"` 配置。
  现有客户（Newgen）无这些列 → 无限+全解锁，已线上验证不受影响。

### 待办 / 下一步（来自这批的延伸）
- [x] **表格虚拟化（已做，2026-08-19）** —— 手写窗口化，只渲染视口内约一屏（248 行时只渲染 ~36），
  DOM 单元格从约 4000 降到约 577。取代了之前的 content-visibility（那只缓解绘制没减 DOM）。
  滚动容器 ref+onScroll 按 scrollTop 算区间，上下用等高 spacer（ROW_HEIGHT=53）撑滚动条。
  已验证：排序正确、滚动窗口跟随、shift 区间选择正常、全选仍选中全部 248。见 `TrackingModule.tsx`。
- [x] **锁住的 Resources 入口** —— 侧栏第三个锁住入口（配合 Q6 可复用实体页规划）。
- [x] **受限套餐 demo 账号（云端，2026-08-19）** —— 独立部署 `draye-demo`
  （`https://draye-demo-373319016662.us-central1.run.app`，独立 Sheet + demo-track-all 每 8h），
  账号 user01/hermes01，套餐 5次/天 + 仅解锁 8h。用来真实体验受限用户界面。已端到端验证。
- [x] **修 onboard-customer.ps1** —— PS 5.1 下 EAP=Stop 会把原生命令 stderr 进度误当终止错误、脚本一开跑就挂
  （这 bug 让脚本其实从没跑通过）。改 EAP=Continue + `$LASTEXITCODE` 检查 + provision 输出 `2>$null` 取尾行。
- [ ] **OUTGATED 真实验证** —— GROUNDED 箱子彻底查不到 → 自动 OUTGATED 归档，这条只能等生产上真实发生时观察确认
  （本地无法制造"箱子从 BNSF 消失"）。护栏已验证：整批全查无此箱不会误触发归档。
- [ ] **业务信息架构（用户问题 5/6，待定方向）** —— ①集装箱运营字段（size/weight/PU-BK 等）显示在哪个页面、
  用 columns 显示隐藏模型；②公司可复用实体（Freight Forwarder/Consignee/Driver 及其关联）放哪。
  倾向：①归入 Dispatch 页、沿用 tracking 的列显示/隐藏；②做一个独立的 Resources/设置页（注意这跟之前推翻的
  "可复用下拉字段"设计相关，见上文那一节）。等用户拍板方向再动手。

## CI/CD 自动部署（进行中 —— 见下）

- [x] **`gcloud run deploy --source .` 单命令部署已验证可用**（每次改完我直接跑这个，源码上传 → Cloud Build 建镜像 → 部署）。
- [ ] **GitHub push 自动触发（方案 B，用户选的）** —— `cloudbuild.yaml` 已写好（build→push Artifact Registry→deploy）。还差两步需要用户在浏览器操作：① 在 Cloud Build 控制台连接 GitHub 仓库并建"push 到 master 触发"的 trigger；② 给 Cloud Build 服务账号授权（`roles/run.admin` + `roles/iam.serviceAccountUser` + `roles/artifactregistry.writer`，我尝试授权被自动模式拦了，需要用户明确批准）。配好之后 push 即自动上线，不再依赖我手动 deploy。

## 支持 UP (Union Pacific) 抓取（2026-08-19，已实现已部署，待生产真实数据验证）

客户要求加 UP。之前客户自己试过没成功；旧仓库那套 2400 行 DOM 抓取一直不稳。这次重做，走通了：

- [x] **逆向清楚了** —— UP 必须登录（MyUPRR/SiteMinder SSO，两步 UserID→CONTINUE→密码→SIGN IN）。
  **headless 实测能登进去，没被反爬拦**（老代码脆弱是选择器错 + 只抓 DOM）。用两个真实箱号
  (NYKU3685258/SMCU1115772) 端到端验证，结果跟客户手动查的完全一致（截图已发客户）。
- [x] **不抓 DOM，直接拦 JSON 接口** —— Track Shipments 填箱号(最多 1000)→SUBMIT，页面 POST
  `build-shipment-view/2.0` 返回干净 JSON。爬虫拦响应解析。一次能查 1000 个（BNSF 只 100）。
- [x] **多 carrier 路由** —— `carriers/index.ts` getCrawler 注册表；server 按 carrier 分组各用各的爬虫、
  进度累加；SUPPORTED_CARRIERS 前后端加 'UP'；Add Containers 的 Rail 选择器自动多出 UP。BNSF 不受影响。
- [x] **凭据走环境变量** —— UP_USERNAME/UP_PASSWORD，生产在 Cloud Run（draye-mvp 已设），本地在 .env。
  `npm run verify:up` 排查。字段映射对齐 BNSF 的 extra key，状态判定/列直接复用。
- [ ] **生产真实验证** —— 需要往 Newgen 加 carrier=UP 的箱号跑一次 Track All，确认线上整条链路。
  爬虫本身已实测通过；这一步是确认多 carrier 在生产环境的集成没问题（等客户确认要不要把那两个
  UP 箱号正式加进生产追踪）。

## 明确排除在这版之外

Dispatch、Invoice（客户可见）、Driver App、UP/CNHAR carrier、多租户账号系统、计费系统 —— 这些不是"以后要做的下一步"，是这版 MVP 有意不做的范围，不要在做当前任务时顺手把它们加回来。
