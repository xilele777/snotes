param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [string]$Sdk = $env:ANDROID_HOME
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
& git -C $root cat-file -e "$SourceCommit^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'SourceCommit must identify an existing build source commit.' }
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$metadata = Get-Content -LiteralPath (Join-Path $root 'android/app/build/outputs/apk/debug/output-metadata.json') -Raw | ConvertFrom-Json
$apkEntry = $metadata.elements[0]
if ($apkEntry.versionName -ne $package.version -or $metadata.applicationId -ne 'io.github.xilele777.snotes.debug') {
    throw 'Build a current debug APK before packaging.'
}
$apk = Join-Path $root ('android/app/build/outputs/apk/debug/' + $apkEntry.outputFile)
$signer = Join-Path $Sdk 'build-tools/36.0.0/apksigner.bat'
$badging = Join-Path $Sdk 'build-tools/36.0.0/aapt2.exe'
$certificates = @(& $signer verify --print-certs $apk)
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$badge = @(& $badging dump badging $apk)
if ($LASTEXITCODE -ne 0) { throw 'APK manifest inspection failed.' }
if ($badge[0] -notlike "*name='$($metadata.applicationId)' versionCode='$($apkEntry.versionCode)' versionName='$($package.version)'*") {
    throw 'APK manifest differs from build metadata.'
}
if (-not ($certificates | Select-String 'certificate DN: .*CN=Android Debug(?:,|$)')) {
    throw 'This packaging script is reserved for debug-signed internal APKs.'
}
$certificateHash = ($certificates | Select-String 'Signer #1 certificate SHA-256 digest:').ToString().Split(':')[-1].Trim()
$directory = Join-Path $root 'artifacts/android'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$filename = "snotes-$($package.version)-internal-vc$($apkEntry.versionCode).apk"
$output = Join-Path $directory $filename
Copy-Item -LiteralPath $apk -Destination $output -Force
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
[ordered]@{
    applicationVersion = $package.version
    versionCode = $apkEntry.versionCode
    applicationId = $metadata.applicationId
    sourceCommit = $SourceCommit
    buildType = 'debug; internal manual acceptance; not a production release'
    filename = $filename
    sizeBytes = (Get-Item -LiteralPath $output).Length
    sha256 = $hash
    certificateSha256 = $certificateHash
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    toolchain = 'JDK21 / Gradle9.5.0 / AGP9.3.0 / Kotlin2.2.10 / SDK37 / BuildTools36.0.0'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'manifest.json') -Encoding utf8
"$hash  $filename" | Set-Content -LiteralPath (Join-Path $directory 'SHA256SUMS.txt') -Encoding ascii
$certificates | Set-Content -LiteralPath (Join-Path $directory 'signature.txt') -Encoding utf8
$badge | Set-Content -LiteralPath (Join-Path $directory 'apk-manifest.txt') -Encoding utf8
foreach ($document in @('manual-checklist.md', '2026-11-20-m4-m6.md', 'performance-2026-11-20.json')) {
    Copy-Item -LiteralPath (Join-Path $root "docs/android/acceptance/$document") -Destination (Join-Path $directory $document) -Force
}
@"
# snotes Android 内部安装包

应用版本 $($package.version)，versionCode $($apkEntry.versionCode)，Android 8.0 / API 26 及以上。
本包使用 debug 签名，包名 $($metadata.applicationId)，与正式应用可并存。

1. 将 $filename 复制到手机，允许本次安装来源后安装；或执行 adb install -r $filename。
2. 可先离线写作；需要同步时在设置接入自己的 HTTPS 服务端 origin 与 Owner 令牌。
3. 按 manual-checklist.md 验收。自动验证与模拟器性能见 2026-11-20-m4-m6.md。

SHA-256 见 SHA256SUMS.txt，构建源码与签名摘要见 manifest.json。
本包待人工验收，未正式发布；真机 / 中文输入法 / TalkBack / 系统选择器 / 省电与生产签名仍待确认。
"@ | Set-Content -LiteralPath (Join-Path $directory 'README.md') -Encoding utf8
$bundleFiles = @($filename, 'README.md', 'manifest.json', 'SHA256SUMS.txt', 'signature.txt', 'apk-manifest.txt', 'manual-checklist.md', '2026-11-20-m4-m6.md', 'performance-2026-11-20.json') | ForEach-Object { Join-Path $directory $_ }
$zip = Join-Path $directory "snotes-$($package.version)-internal-vc$($apkEntry.versionCode).zip"
Compress-Archive -LiteralPath $bundleFiles -DestinationPath $zip -Force
Write-Output "APK: $output"
Write-Output "SHA-256: $hash"
Write-Output "ZIP: $zip"
