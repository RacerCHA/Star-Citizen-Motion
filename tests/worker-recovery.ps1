# SPDX-License-Identifier: GPL-3.0-or-later
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$testDir=Join-Path $PSScriptRoot ('runtime\workers-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testDir)
$exe=Join-Path $testDir 'SCWorkerRecoveryTest.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe ('/out:'+$exe) (Join-Path $PSScriptRoot 'worker-recovery.cs') (Join-Path $root 'OwnedWorker.cs') (Join-Path $root 'RuntimeFiles.cs')
if($LASTEXITCODE -ne 0){throw 'Test compilation failed'}
& $exe
if($LASTEXITCODE -ne 0){throw 'Worker recovery test failed'}
