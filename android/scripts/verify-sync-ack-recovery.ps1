param(
    [Parameter(Mandatory = $true)][string]$AdbPath,
    [ValidateSet('node', 'worker')][string]$Backend = 'node',
    [string]$Serial = 'emulator-5580'
)
$ErrorActionPreference = 'Stop'
$appId = 'io.github.xilele777.snotes.debug'
$runner = "$appId.test/androidx.test.runner.AndroidJUnitRunner"
$fixture = 'io.github.xilele777.snotes.core.SyncAckProcessFixture'
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../app/build'))
$readyPath = "cache/m3-ack-$Backend/ready"
# Only these build logs and the fixture's readiness file are touched; no profile database is deleted by this script.
& $AdbPath -s $Serial shell run-as $appId rm -f $readyPath
$process = Start-Process -FilePath $AdbPath -ArgumentList @('-s', $Serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', "${fixture}#prepare", '-e', 'm3Backend', $Backend, $runner) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $outputDirectory "ack-$Backend-prepare.txt") -RedirectStandardError (Join-Path $outputDirectory "ack-$Backend-prepare-error.txt")
$ready = $false
for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $null = & $AdbPath -s $Serial shell run-as $appId test -f $readyPath
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw "Server acceptance readiness was not observed; inspect ack-$Backend-prepare.txt" }
$beforeKill = & $AdbPath -s $Serial shell pidof $appId
if (-not $beforeKill) { throw 'Fixture process already exited; cannot claim an actual pre-ACK kill' }
& $AdbPath -s $Serial shell am force-stop $appId
if ($LASTEXITCODE -ne 0) { throw 'force-stop failed' }
$afterKill = & $AdbPath -s $Serial shell pidof $appId
if ($afterKill) { throw 'Application process still exists after force-stop' }
$process.WaitForExit(5000) | Out-Null
$result = & $AdbPath -s $Serial shell am instrument -w -e class "${fixture}#verify" -e m3Backend $Backend $runner
$result | Write-Output
if ($LASTEXITCODE -ne 0 -or ($result -join "`n") -notmatch 'OK \(1 test\)') { throw 'Pre-ACK process recovery verification failed' }
Write-Output "Verified ${Backend}: server accepted creation, live process was force-stopped before ACK, replay and recovery passed."
