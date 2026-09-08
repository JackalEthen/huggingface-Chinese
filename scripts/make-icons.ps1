# 从项目根目录 icon.png 生成 16/32/48/128 四个尺寸的图标到 icons/
Add-Type -AssemblyName System.Drawing
$src = Join-Path $PSScriptRoot "..\icon.png"
if (-not (Test-Path $src)) { Write-Error "icon.png 不存在，请先放入项目根目录"; exit 1 }

$dir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$img = [System.Drawing.Image]::FromFile($src)
foreach ($size in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save((Join-Path $dir "$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
$img.Dispose()
Write-Host "已生成 icons/16.png 32.png 48.png 128.png"
