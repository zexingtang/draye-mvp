<#
一键给新客户开通：建 Google Sheet（Tracking/Columns/Account 三个 tab）、写入客户账号信息、
分享给部署用的服务账号、部署一个独立的 Cloud Run 服务、建一个独立的 Cloud Scheduler 定时任务。
跑完打印登录信息和服务地址，可以直接整理发给客户。

现在这版架构是"一个客户一套部署"（独立 Sheet + 独立 Cloud Run 服务 + 独立定时任务），
不是所有客户共用一个服务——每次跑这个脚本都会真的新建一套云资源，会产生新的 Cloud Run 账单项。

用法：
  .\scripts\onboard-customer.ps1 -CompanyName "客户公司名" -Username admin -Password xxxx
  .\scripts\onboard-customer.ps1 -CompanyName "客户公司名" -Username admin -Password xxxx -ScheduleHours 2

前提：
- 在 draye-mvp 仓库根目录跑
- gcloud 已登录、当前项目已经是 draye-mvp（gcloud config get-value project 确认一下）
- 如果 gcloud 命令报"CommandLoadFailure"之类的 Python 版本错误，先跑一次：
    $env:CLOUDSDK_PYTHON = "C:\Users\ZT\AppData\Local\Programs\Python\Python311\python.exe"

注意：重复用同一个公司名跑两次，会新建第二个 Sheet（不会复用已有的），但会复用/更新同名的
Cloud Run 服务——如果是手误重复执行，先确认是不是真的要开新表，别把已有客户的数据搞乱。
#>

param(
  [Parameter(Mandatory = $true)][string]$CompanyName,
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Password,
  [int]$ScheduleHours = 4,
  # 套餐：每日手动 Track All 上限（0 = 无限）；解锁的定时档位（逗号分隔，空 = 全部 1,2,4,8）。
  # 例：-MaxTrackAllPerDay 5 -AllowedScheduleHours "8" 就是受限套餐。
  [int]$MaxTrackAllPerDay = 0,
  [string]$AllowedScheduleHours = ""
)

$ErrorActionPreference = "Stop"

$Region = "us-central1"
$ServiceAccount = "draye-crawler@draye-mvp.iam.gserviceaccount.com"

# 公司名转成合法的 Cloud Run 服务名 / Scheduler 任务名：小写、非字母数字都换成连字符、
# 首尾连字符去掉（Cloud Run 服务名规则：小写字母数字和连字符，不能以连字符开头结尾）
$Slug = ($CompanyName.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
if (-not $Slug) {
  throw "公司名转出来的 slug 是空的，换个包含字母/数字的公司名再试"
}
$ServiceName = "draye-$Slug"
$JobName = "$Slug-track-all"

Write-Host "== 1/4 建 Google Sheet + 写入账号信息 + 分享给服务账号 ==" -ForegroundColor Cyan
# 0 表示无限，转成空字符串传给 provision（空=无限）。
$MaxArg = if ($MaxTrackAllPerDay -gt 0) { "$MaxTrackAllPerDay" } else { "" }
$SheetId = (npx tsx src/dev/provision-sheet.ts "$CompanyName" "$Username" "$Password" "$MaxArg" "$AllowedScheduleHours" | Select-Object -Last 1).Trim()
if (-not $SheetId) {
  throw "没拿到 Sheet ID，上面 provision-sheet.ts 的输出里看看是不是报错了"
}
Write-Host "Sheet ID: $SheetId"

Write-Host "== 2/4 生成定时任务密钥 ==" -ForegroundColor Cyan
$SchedulerSecret = node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

Write-Host "== 3/4 部署 Cloud Run 服务: $ServiceName（第一次跑的话会比较慢，要建镜像）==" -ForegroundColor Cyan
gcloud run deploy $ServiceName `
  --source . `
  --region $Region `
  --service-account $ServiceAccount `
  --allow-unauthenticated `
  --memory 2Gi `
  --timeout 300 `
  --set-env-vars "SHEET_ID=$SheetId,SCHEDULER_SECRET=$SchedulerSecret" `
  --quiet

$ServiceUrl = gcloud run services describe $ServiceName --region $Region --format="value(status.url)"

Write-Host "== 4/4 建定时任务: $JobName（每 $ScheduleHours 小时）==" -ForegroundColor Cyan
# "任务不存在"是正常会出现的情况(第一次给这个客户建任务),gcloud 会报非零退出码——
# $ErrorActionPreference = "Stop" 会把这种非终止错误也升级成终止错误,必须用 try/catch 接住,
# 不然脚本会在这里直接跑挂,后面创建任务的逻辑根本走不到。
$JobExists = $null
try {
  $JobExists = gcloud scheduler jobs describe $JobName --location $Region --format="value(name)" 2>$null
} catch {
  $JobExists = $null
}
if ($JobExists) {
  gcloud scheduler jobs update http $JobName `
    --location $Region `
    --schedule="0 */$ScheduleHours * * *" `
    --uri="$ServiceUrl/api/tracking/trigger" `
    --update-headers="X-Scheduler-Secret=$SchedulerSecret" `
    --attempt-deadline=300s `
    --quiet
} else {
  gcloud scheduler jobs create http $JobName `
    --location $Region `
    --schedule="0 */$ScheduleHours * * *" `
    --uri="$ServiceUrl/api/tracking/trigger" `
    --http-method=POST `
    --headers="X-Scheduler-Secret=$SchedulerSecret" `
    --attempt-deadline=300s `
    --quiet
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "客户开通完成"
Write-Host "==========================================" -ForegroundColor Green
Write-Host "公司名:     $CompanyName"
Write-Host "服务地址:   $ServiceUrl"
Write-Host "用户名:     $Username"
Write-Host "密码:       $Password"
Write-Host "定时抓取:   每 $ScheduleHours 小时"
Write-Host "Sheet:      https://docs.google.com/spreadsheets/d/$SheetId/edit"
Write-Host "=========================================="
