param(
    [Parameter(Mandatory = $true)][string]$AdbPath,
    [string]$Serial = 'emulator-5580'
)
$ErrorActionPreference = 'Stop'
$appId = 'io.github.xilele777.snotes.debug'
$testRunner = "$appId.test/androidx.test.runner.AndroidJUnitRunner"
$fixtureClass = 'io.github.xilele777.snotes.core.ProcessRecoveryFixture'
function Invoke-Fixture([string]$Method) {
    $result = & $AdbPath -s $Serial shell am instrument -w -e class "${fixtureClass}#$Method" $testRunner
    $result | Write-Output
    if ($LASTEXITCODE -ne 0 -or ($result -join "`n") -notmatch 'OK \(1 test\)') {
        throw "Process fixture $Method failed"
    }
}
Invoke-Fixture 'prepare'
$beforeKill = & $AdbPath -s $Serial shell pidof $appId
if ($beforeKill) {
    & $AdbPath -s $Serial shell am force-stop $appId
    if ($LASTEXITCODE -ne 0) { throw 'force-stop failed' }
    $afterKill = & $AdbPath -s $Serial shell pidof $appId
    if ($afterKill) { throw 'Application process still exists after force-stop' }
} else {
    Write-Output 'Preparation process already exited; this run validates fresh-process recovery, not an immediate force-stop boundary.'
}
Invoke-Fixture 'verify'
Write-Output 'Verified fresh-process recovery: stale receipt skipped, staged revision 7 recovered.'
