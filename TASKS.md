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

## 明确排除在这版之外

Dispatch、Invoice（客户可见）、Driver App、UP/CNHAR carrier、多租户账号系统、计费系统 —— 这些不是"以后要做的下一步"，是这版 MVP 有意不做的范围，不要在做当前任务时顺手把它们加回来。
