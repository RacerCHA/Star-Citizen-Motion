# SPDX-License-Identifier: GPL-3.0-or-later
# Exercise the actual installer functions under Windows PowerShell 5.1 in a fixture.
# No installed D-BOX files are changed.
$ErrorActionPreference='Stop'
$fixture=Join-Path $PSScriptRoot ('runtime\installer-test-'+[Guid]::NewGuid().ToString('N'))
$baseDir=Join-Path $fixture 'LiveMotion'
$connectorDir=Join-Path $baseDir 'LiveMotionConnector'
$gameDir=Join-Path $baseDir 'StarCitizen'
$runtimeDir=Join-Path $fixture 'backup'
$manifestPath=Join-Path $runtimeDir 'manifest.json'
foreach($p in @($connectorDir,$gameDir,$runtimeDir)){[void][IO.Directory]::CreateDirectory($p)}
$original=Join-Path $runtimeDir 'original.crt'
$customCert=Join-Path $runtimeDir 'custom.crt'
[IO.File]::WriteAllText($original,'TEST ORIGINAL')
[IO.File]::WriteAllText($customCert,'TEST CUSTOM')
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path (Split-Path $PSScriptRoot -Parent) 'Apply-DBox.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Installer parse error.'}
foreach($name in @('Hash-File','Check-Target','Write-Atomic','Restore-Changes')){
    $fn=$ast.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$false)
    if(-not $fn){throw ('Missing function '+$name)}
    . ([scriptblock]::Create($fn.Extent.Text))
}
$originalHash=Hash-File $original
$customHash=Hash-File $customCert
$target=Join-Path $connectorDir 'livemotion.crt'
$new=Join-Path $gameDir 'livemotion.crt'
function Assert-True($ok,[string]$message){if(-not $ok){throw $message}}
Write-Atomic $original $target
Assert-True ((Hash-File $target) -eq $originalHash) 'New file failed.'
Write-Atomic $customCert $target
Assert-True ((Hash-File $target) -eq $customHash) 'Existing file replacement failed.'
Write-Atomic $original $target
Assert-True ((Hash-File $target) -eq $originalHash) 'Restore replacement failed.'
[IO.File]::Copy($customCert,($target+'.sc-capture-tmp'))
Write-Atomic $customCert $target
Assert-True (-not (Test-Path -LiteralPath ($target+'.sc-capture-tmp'))) 'Known stale temp was not cleaned.'
Assert-True ((Hash-File $target) -eq $customHash) 'Stale recovery failed.'
[IO.File]::WriteAllText(($target+'.sc-capture-tmp'),'UNKNOWN DATA')
$refused=$false
try{Write-Atomic $original $target}catch{$refused=$true}
Assert-True $refused 'Unknown staging content was not refused.'
Assert-True ([IO.File]::ReadAllText($target+'.sc-capture-tmp') -eq 'UNKNOWN DATA') 'Unknown staging content was changed.'
Remove-Item -LiteralPath ($target+'.sc-capture-tmp')
$lock=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$failed=$false
try{try{Write-Atomic $original $target}catch{$failed=$true}}finally{$lock.Dispose()}
Assert-True $failed 'Expected locked-file replacement failure.'
Assert-True ((Hash-File $target) -eq $customHash) 'Locked destination changed.'
Assert-True (@(Get-ChildItem -LiteralPath $connectorDir -Filter '*.tmp').Count -eq 0) 'Failed write left staging file.'
Write-Atomic $customCert $new
$m=[pscustomobject]@{state='installed';entries=@(
    [pscustomobject]@{target=$target;existed=$true;original_hash=$originalHash;installed_hash=$customHash;backup_name='original.crt'},
    [pscustomobject]@{target=$new;existed=$false;original_hash=$null;installed_hash=$customHash;backup_name=$null}
)}
Restore-Changes $m
Assert-True ((Hash-File $target) -eq $originalHash) 'Rollback failed to restore original.'
Assert-True (-not (Test-Path -LiteralPath $new)) 'Rollback left newly installed file.'
Restore-Changes $m
$refused=$false
try{Write-Atomic $customCert (Join-Path $fixture 'livemotion.crt')}catch{$refused=$true}
Assert-True $refused 'Destination scope check failed.'
$report=[pscustomobject]@{pass=$true;powershell=$PSVersionTable.PSVersion.ToString();scope='WORKSPACE FIXTURE ONLY';checks=@('new file','existing file atomic replacement','restore','known stale temp cleanup','unknown stale temp preserved','locked file failure cleanup','rollback and repeat rollback','destination scope')}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $fixture 'installer-test-result.json') -Encoding UTF8
Write-Output ('PASS: installer recovery and rollback; PowerShell '+$report.powershell)
