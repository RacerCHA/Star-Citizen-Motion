# SPDX-License-Identifier: GPL-3.0-or-later
# Only D-BOX's two LiveMotion folders are affected. Default: read-only plan.
[CmdletBinding()]
param([switch]$Apply, [switch]$Rollback)
$ErrorActionPreference = 'Stop'
if ($Apply -and $Rollback) { throw 'Choose Apply or Rollback.' }
$baseDir = 'C:\ProgramData\D-BOX\Gaming\LiveMotion'
$connectorDir = Join-Path $baseDir 'LiveMotionConnector'
$gameDir = Join-Path $baseDir 'StarCitizen'
$runtimeDir = Join-Path $PSScriptRoot 'runtime'
$manifestPath = Join-Path $runtimeDir 'dbox-change-manifest.json'
$customCert = Join-Path $runtimeDir 'cert\lm.crt'
$originalHash = '6F5B4B7AD89B482A298E5947BDF0CB87480930E8ECF3275AA9C27117178D97AD'
$dllHash = '85A6E973B3290C4FD39C1CCC2E1A7156C4646CE3987F42976C8FA7747982BA6A'
function Hash-File([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function Check-Target([string]$p) {
    $full = [IO.Path]::GetFullPath($p)
    $parent = [IO.Path]::GetDirectoryName($full)
    if ($parent -notin @($connectorDir,$gameDir)) { throw ('Unexpected target: '+$full) }
    if ([IO.Path]::GetFileName($full) -notin @('dbxLive64.dll','dbxLive32.dll','livemotion.crt','LiveMotionConnector.config','LiveMotionConnector.log.config')) { throw 'Unexpected filename.' }
    foreach ($dir in @($baseDir,$connectorDir,$gameDir)) {
        if (Test-Path -LiteralPath $dir) {
            if (((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Refusing reparse point: '+$dir) }
        }
    }
}
function Write-Atomic([string]$src,[string]$dst) {
    Check-Target $dst
    $sourceHash = Hash-File $src
    # Recover only a verified staging file left by the earlier installer.
    $legacyTmp = $dst+'.sc-capture-tmp'
    if (Test-Path -LiteralPath $legacyTmp) {
        if (((Get-Item -LiteralPath $legacyTmp -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing staging reparse point.' }
        $knownHashes = @($sourceHash,$originalHash)
        if (Test-Path -LiteralPath $customCert) { $knownHashes += (Hash-File $customCert) }
        if ((Hash-File $legacyTmp) -notin $knownHashes) { throw ('Unrecognized staging file preserved: '+$legacyTmp) }
        Remove-Item -LiteralPath $legacyTmp -Force
    }
    $tmp = $dst+'.sc-capture-'+[Guid]::NewGuid().ToString('N')+'.tmp'
    $ownTemp = $false
    try {
        [IO.File]::Copy($src,$tmp,$false)
        $ownTemp = $true
        if ((Hash-File $tmp) -ne $sourceHash) { throw 'Staging hash mismatch.' }
        if (Test-Path -LiteralPath $dst) {
            # PowerShell 5.1 converts ordinary $null to an empty string here.
            [IO.File]::Replace($tmp,$dst,[System.Management.Automation.Language.NullString]::Value)
        } else { [IO.File]::Move($tmp,$dst) }
    } finally {
        if ($ownTemp -and (Test-Path -LiteralPath $tmp)) {
            if ((Hash-File $tmp) -eq $sourceHash) { Remove-Item -LiteralPath $tmp -Force }
        }
    }
}
function Restore-Changes($m) {
    foreach ($e in @($m.entries)) { Check-Target $e.target }
    foreach ($e in @($m.entries)) {
        if (-not (Test-Path -LiteralPath $e.target)) {
            if ($e.existed) { throw ('Original target missing: '+$e.target) }
            continue
        }
        $current = Hash-File $e.target
        if ($e.existed -and $current -eq $e.original_hash) { continue }
        if ($current -ne $e.installed_hash) { throw ('File changed since installation; refusing overwrite: '+$e.target) }
        if ($e.existed) {
            $backup = Join-Path $runtimeDir $e.backup_name
            if ((Hash-File $backup) -ne $e.original_hash) { throw 'Backup hash mismatch.' }
            Write-Atomic $backup $e.target
        } else { Remove-Item -LiteralPath $e.target -Force }
    }
    $m.state='rolled_back'
    $m | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Write-Output 'Rollback complete. Original D-BOX certificate restored. Empty StarCitizen folder may remain.'
}
if ($Rollback) {
    if (Get-Process -Name StarCitizen -ErrorAction SilentlyContinue) { throw 'Close Star Citizen before rollback.' }
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No installation manifest.' }
    Restore-Changes (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
    exit 0
}
$dll = Join-Path $connectorDir 'dbxLive64.dll'
if ((Hash-File $dll) -ne $dllHash) { throw 'Expected signed connector 2.0.0.20040 from HSC 1.4.0. Source DLL differs.' }
$sig = Get-AuthenticodeSignature -LiteralPath $dll
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'D-BOX Technologies') { throw 'D-BOX signature verification failed.' }
if (-not (Test-Path -LiteralPath $customCert)) { throw 'Local certificate missing. Run New-LocalCertificate.ps1 with PowerShell 7 first.' }
$customHash = Hash-File $customCert
if (Test-Path -LiteralPath $manifestPath) {
    $previous = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($previous.state -eq 'installed') {
        foreach ($e in @($previous.entries)) {
            Check-Target $e.target
            if ((Hash-File $e.target) -ne $e.installed_hash) { throw ('Installed file has changed: '+$e.target) }
        }
        if ($previous.certificate_hash -ne $customHash) { throw 'Local certificate differs from installed certificate.' }
        Write-Output 'Already installed and verified.'; exit 0
    }
    if ($previous.state -ne 'rolled_back') { throw 'An incomplete transaction exists. Run rollback first.' }
}
$commonCert = Join-Path $connectorDir 'livemotion.crt'
if ((Hash-File $commonCert) -ne $originalHash) { throw 'D-BOX original certificate differs. Refusing replacement.' }
[xml]$config = Get-Content -LiteralPath (Join-Path $connectorDir 'LiveMotionConnector.config') -Raw
if ($config.Configuration.ReceiverIpAddress -ne '127.0.0.1' -or $config.Configuration.ReceiverPort -ne '61666' -or $config.Configuration.CertificateCommonName -ne 'LiveMotionComm') { throw 'Unexpected connector destination.' }
$entries=@()
foreach ($name in @('dbxLive64.dll','dbxLive32.dll','LiveMotionConnector.config','LiveMotionConnector.log.config')) {
    $src = Join-Path $connectorDir $name
    $dst = Join-Path $gameDir $name
    Check-Target $dst
    if (Test-Path -LiteralPath $dst) { throw ('Target already exists without matching manifest: '+$dst) }
    $entries += [pscustomobject]@{target=$dst;source=$src;existed=$false;original_hash=$null;installed_hash=(Hash-File $src);backup_name=$null}
}
$gameCert = Join-Path $gameDir 'livemotion.crt'
if (Test-Path -LiteralPath $gameCert) { throw 'StarCitizen certificate already exists without matching manifest.' }
$entries += [pscustomobject]@{target=$gameCert;source=$customCert;existed=$false;original_hash=$null;installed_hash=$customHash;backup_name=$null}
$entries += [pscustomobject]@{target=$commonCert;source=$customCert;existed=$true;original_hash=$originalHash;installed_hash=$customHash;backup_name='dbox-original-livemotion.crt'}
Write-Output 'Plan: copy the signed D-BOX connector into D-BOX\Gaming\LiveMotion\StarCitizen.'
Write-Output 'Trust this local capture server by changing ONLY these two D-BOX certificate files:'
Write-Output $gameCert
Write-Output $commonCert
Write-Output 'No Windows root-store, game, anti-cheat, service, firewall or platform settings are changed.'
Write-Output 'This is unofficial. Compatibility with game terms / anti-cheat is not established.'
if (-not $Apply) { Write-Output 'READ-ONLY PLAN. To apply: run Apply-DBox.ps1 -Apply.'; exit 0 }
if (Get-Process -Name StarCitizen -ErrorAction SilentlyContinue) { throw 'Close Star Citizen before applying.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run Setup-DBox.cmd as administrator using your usual Windows account.' }
[void][IO.Directory]::CreateDirectory($runtimeDir)
$backupPath = Join-Path $runtimeDir 'dbox-original-livemotion.crt'
if (Test-Path -LiteralPath $backupPath) {
    if ((Hash-File $backupPath) -ne $originalHash) { throw 'Unexpected backup content.' }
} else { [IO.File]::Copy($commonCert,$backupPath,$false) }
$manifest=[pscustomobject]@{state='prepared';created=[DateTimeOffset]::Now.ToString('o');certificate_hash=$customHash;entries=$entries}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
try {
    [void][IO.Directory]::CreateDirectory($gameDir)
    foreach ($e in $entries) {
        Write-Atomic $e.source $e.target
        if ((Hash-File $e.target) -ne $e.installed_hash) { throw ('Post-write hash mismatch: '+$e.target) }
    }
    $manifest.state='installed'
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Write-Output 'INSTALLED AND VERIFIED. Start the capture server, then launch Star Citizen normally.'
} catch {
    $failure=$_
    try { Restore-Changes $manifest } catch { Write-Warning ('Rollback needs attention: '+$_.Exception.Message) }
    throw $failure
}
