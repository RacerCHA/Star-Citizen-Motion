# SPDX-License-Identifier: GPL-3.0-or-later
# Run only in the repository's GitHub Actions release job.
$ErrorActionPreference='Stop'
if(-not $env:GITHUB_TOKEN -or -not $env:GITHUB_REPOSITORY -or -not $env:GITHUB_SHA){throw 'GitHub Actions release context is required.'}
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$version=(Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version.'}
$tag='v'+$version
$api='https://api.github.com/repos/'+$env:GITHUB_REPOSITORY
$headers=@{Authorization='Bearer '+$env:GITHUB_TOKEN;Accept='application/vnd.github+json';'X-GitHub-Api-Version'='2022-11-28'}
function Get-Optional([string]$url){
    try{return Invoke-RestMethod -Uri $url -Headers $headers}
    catch{if($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404){return $null};throw}
}
function Send-Json([string]$method,[string]$url,$body){
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ($body | ConvertTo-Json -Depth 8)
}
$existingTag=Get-Optional ($api+'/git/ref/tags/'+$tag)
if($existingTag){
    if($existingTag.object.sha -ne $env:GITHUB_SHA){
        $published=Get-Optional ($api+'/releases/tags/'+$tag)
        if($published -and -not $published.draft){Write-Output ('Release '+$tag+' already published; preserved. Bump VERSION for another release.');exit 0}
        throw 'The version tag already points to another commit; refusing to move it.'
    }
}else{
    Send-Json 'Post' ($api+'/git/refs') @{ref='refs/tags/'+$tag;sha=$env:GITHUB_SHA} | Out-Null
}
$release=Get-Optional ($api+'/releases/tags/'+$tag)
if($release -and -not $release.draft){Write-Output ('Release '+$tag+' already published; preserved.');exit 0}
if(-not $release){
    $body=@"
Star Citizen → SimHub Motion: первая зафиксированная версия до интеграции MOZA.

- Приложение Windows в трее с синей молнией.
- Ускорения, угловые скорости и скорости; семейство Flight.
- Без сглаживания и ограничения пиков в мосте.
- Установка с нуля, индивидуальный сертификат и откат D-BOX.

Скачайте ZIP ниже и распакуйте целиком. Инструкция — README.md в архиве и репозитории.
Зависимости: Node.js, PowerShell 7, SimHub и проверенный D-BOX HSC 1.4.0.
Приватные ключи и бинарные файлы D-BOX в архив не входят. Выхода MOZA в этой версии нет.
"@
    $release=Send-Json 'Post' ($api+'/releases') @{tag_name=$tag;target_commitish=$env:GITHUB_SHA;name=$tag+' — Star Citizen → SimHub Motion';body=$body;draft=$true;prerelease=$false}
}
$files=@((Join-Path $root ('dist/StarCitizen-Motion-'+$tag+'-win-x64.zip')),(Join-Path $root 'dist/SHA256SUMS.txt'))
foreach($file in $files){
    if(-not (Test-Path -LiteralPath $file)){throw ('Missing release asset: '+[IO.Path]::GetFileName($file))}
    $name=[IO.Path]::GetFileName($file)
    $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $asset=@($release.assets | Where-Object name -eq $name)
    if($asset.Count){if($asset[0].digest -ne ('sha256:'+$hash)){throw ('Existing asset differs: '+$name)};continue}
    $upload=($release.upload_url -replace '\{.*\}$','')+'?name='+[Uri]::EscapeDataString($name)
    Invoke-RestMethod -Method Post -Uri $upload -Headers $headers -ContentType 'application/octet-stream' -InFile $file | Out-Null
    Write-Output ('Uploaded '+$name)
}
Send-Json 'Patch' ($api+'/releases/'+$release.id) @{draft=$false} | Out-Null
Write-Output ('Published https://github.com/'+$env:GITHUB_REPOSITORY+'/releases/tag/'+$tag)
