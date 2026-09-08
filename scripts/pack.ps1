# 本地打包 CRX：
# 1. 生成图标（如尚未生成）
# 2. 将干净副本（排除 scripts/prototype/release）拷入 staging
# 3. 用 Chrome 或 Edge --pack-extension 打包，产出 .crx 和 .pem（私钥，妥善保存，更新必须用同一把）
#
# 用法：powershell -File scripts\pack.ps1
param([string]$BrowserPath = "")

# ---------- 定位浏览器 ----------
if (-not $BrowserPath -or -not (Test-Path $BrowserPath)) {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    )
    $BrowserPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $BrowserPath) {
    Write-Error "未找到 Chrome 或 Edge，请用 -BrowserPath 指定浏览器完整路径"
    exit 1
}
Write-Host "使用浏览器：$BrowserPath"

# ---------- 准备 ----------
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$out = Join-Path $root "release"
New-Item -ItemType Directory -Force -Path $out | Out-Null

if (-not (Test-Path (Join-Path $root "icons\128.png"))) {
    & (Join-Path $PSScriptRoot "make-icons.ps1")
}

# ---------- staging：只拷贝插件运行所需文件 ----------
$stage = Join-Path $out "_stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($f in "manifest.json", "background.js", "content.js", "popup.html", "popup.js",
               "options.html", "options.js", "dict.json", "icons") {
    Copy-Item (Join-Path $root $f) -Destination $stage -Recurse
}

# ---------- 打包 ----------
# Edge/Chrome 打包时若浏览器已在运行，--pack-extension 不弹窗，直接写文件后退出；
# crx/pem 产出在 staging 目录的同目录下（release\），命名 _stage.crx/_stage.pem
$pem = Join-Path $out "hf-chinese.pem"
$crx = Join-Path $out "hf-chinese.crx"
$old = @("$out\_stage.crx", "$out\_stage.pem") | Where-Object { Test-Path $_ }
if ($old) { Remove-Item $old -Force }

# 已有私钥则复用（保证升级签名一致）；没有则首次打包自动生成
if (Test-Path $pem) {
    & $BrowserPath "--pack-extension=$stage" "--pack-extension-key=$pem" | Out-Null
} else {
    & $BrowserPath "--pack-extension=$stage" | Out-Null
}
Start-Sleep -Seconds 3

# ---------- 收尾 ----------
if (Test-Path "$out\_stage.crx") {
    Move-Item "$out\_stage.crx" $crx -Force
    if (Test-Path "$out\_stage.pem") { Move-Item "$out\_stage.pem" $pem -Force }
    Write-Host "已产出 $crx"
    if (Test-Path $pem) { Write-Host "私钥：$pem（勿入库，勿丢失，升级必须复用）" }
} else {
    Write-Error "浏览器未产出 crx。检查：1) staging 路径含中文或空格  2) 浏览器是否被策略禁止打包"
}
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
