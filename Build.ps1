# SPDX-License-Identifier: GPL-3.0-or-later
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not (Test-Path -LiteralPath $csc)){throw 'The .NET Framework 4.x compiler is required.'}
$app=Join-Path $PSScriptRoot 'StarCitizenTelemetry.exe'
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll ('/win32icon:'+(Join-Path $PSScriptRoot 'StarCitizenTelemetry.ico')) ('/out:'+$app) (Join-Path $PSScriptRoot 'TrayApp.cs') (Join-Path $PSScriptRoot 'AssemblyInfo.cs')
if($LASTEXITCODE -ne 0){throw 'Compilation failed.'}
$hostDir=Join-Path $PSScriptRoot 'DCS World\bin'
[void][IO.Directory]::CreateDirectory($hostDir)
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /reference:System.Web.Extensions.dll ('/win32icon:'+(Join-Path $PSScriptRoot 'StarCitizenTelemetry.ico')) ('/out:'+(Join-Path $hostDir 'DCS.exe')) (Join-Path $PSScriptRoot 'DcsHost.cs')
if($LASTEXITCODE -ne 0){throw 'DCS host compilation failed.'}
$settings=Join-Path $PSScriptRoot 'settings.json'
if(-not (Test-Path -LiteralPath $settings)){Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'settings.example.json') -Destination $settings}
Write-Output ('Built: '+$app)
