# 本地打包 CRX：
# 1. 生成图标（如尚未生成）
# 2. 将 manifest 的 icons 字段写好（本脚本不自动改 manifest，见 README 说明）
# 3. 用 Chrome --pack-extension 打包，产出 .crx 和 .pem（私钥，妥善保存，更新必须用同一把）
#
# 用法：powershell -File scripts\pack.ps1 [Chrome路径]
param([string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe")

if (-not (Test-Path $ChromePath)) {
    foreach ($alt in
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") {
        if (Test-Path $alt) { $ChromePath = $alt; break }
    }
}

$root = Join-Path $PSScriptRoot ".."
$icons = Join-Path $root "icons"
if (-not (Test-Path (Join-Path $icons "128.png"))) {
    & (Join-Path $PSScriptRoot "make-icons.ps1")
}

# 打包输出目录
$out = Join-Path $root "release"
New-Item -ItemType Directory -Force -Path $out | Out-Null

# Chrome 打包必须指向包含 manifest.json 的目录；先拷贝干净副本排除 scripts/prototype/release
$stage = Join-Path $out "_stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($f in "manifest.json", "background.js", "content.js", "popup.html", "popup.js",
               "options.html", "options.js", "dict.json", "icons") {
    Copy-Item (Join-Path $root $f) -Destination $stage -Recurse
}

& $ChromePath --pack-extension=$stage --pack-extension-key=(Join-Path $out "hf-chinese.pem") 2>$null

if (Test-Path (Join-Path $stage "..\_stage.crx")) {
    Move-Item (Join-Path $out "_stage.crx") (Join-Path $out "hf-chinese.crx") -Force
    Write-Host "已产出 release\hf-chinese.crx"
} else {
    Write-Host "Chrome 未产出 crx。若首次打包：去掉 --pack-extension-key 参数重试（会自动生成 pem）"
}
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
