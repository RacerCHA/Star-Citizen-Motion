# SPDX-License-Identifier: GPL-3.0-or-later
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'Build.ps1')
$version=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'VERSION') -Raw).Trim()
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Unexpected version.'}
$dist=Join-Path $PSScriptRoot 'dist'
$stage=Join-Path $dist ('stage-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($stage)
$files=@('StarCitizenTelemetry.exe','StarCitizenTelemetry.ico','TrayApp.cs','AssemblyInfo.cs','bridge.mjs','simhub-packet.mjs','StarCitizen.simdef','SimHub-generated-contract.cs','settings.example.json','Build.ps1','Build.cmd','Package.ps1','Prepare-Certificate.cmd','New-LocalCertificate.ps1','Apply-DBox.ps1','Setup-DBox.cmd','Rollback-DBox.cmd','VERSION','README.md','CHANGELOG.md','THIRD-PARTY-NOTICES.md','LICENSE','docs\telemetry.md','docs\development.md','tests\encoder.mjs','tests\receiver.mjs','tests\installer.ps1','receiver\receiver.mjs','receiver\protobuf.mjs','receiver\wire.mjs','receiver\motion-schema.json','upstream\motion_schema.py')
$files+=@('DcsHost.cs','DCS World\bin\DCS.exe','moza-packet.mjs','presets\StarCitizen-AB9-v0.2.preset','presets\StarCitizen-AB9-v0.3-Soft.preset','presets\StarCitizen-AB9-Combat-3.preset','docs\moza.md','tests\moza-encoder.mjs','tests\moza-host.mjs','tests\outputs.mjs','tests\flight-audit.mjs')
$files+=@('status-file.mjs','RuntimeFiles.cs','OwnedWorker.cs','tests\file-lock.mjs','tests\recovery.mjs','tests\worker-recovery.cs','tests\worker-recovery.ps1')
$files+=@('docs\releases\v0.2.1.md')
foreach($relative in $files){
    $source=Join-Path $PSScriptRoot $relative
    $target=Join-Path $stage $relative
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    Copy-Item -LiteralPath $source -Destination $target
}
# Always publish defaults, never the developer's local settings.json.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'settings.example.json') -Destination (Join-Path $stage 'settings.json')
$archive=Join-Path $dist ('StarCitizen-Motion-v'+$version+'-win-x64.zip')
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -Force
$archiveHash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$exeHash=(Get-FileHash -LiteralPath (Join-Path $stage 'StarCitizenTelemetry.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS.txt'),$archiveHash+'  '+[IO.Path]::GetFileName($archive)+"`n"+$exeHash+'  StarCitizenTelemetry.exe'+"`n",[Text.UTF8Encoding]::new($false))
$hostHash=(Get-FileHash -LiteralPath (Join-Path $stage 'DCS World\bin\DCS.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::AppendAllText((Join-Path $dist 'SHA256SUMS.txt'),$hostHash+'  DCS World/bin/DCS.exe'+"`n",[Text.UTF8Encoding]::new($false))
Write-Output ('Release archive: '+$archive)
