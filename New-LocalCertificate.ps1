# SPDX-License-Identifier: GPL-3.0-or-later
# Generates files only; does NOT change Windows trust or D-BOX configuration.
[CmdletBinding()]
param([string]$OutDir = (Join-Path $PSScriptRoot 'runtime\cert'))
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Run with PowerShell 7 (pwsh.exe).' }
$keyPath = Join-Path $OutDir 'lm.key'
$crtPath = Join-Path $OutDir 'lm.crt'
if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $crtPath)) {
    if ((Test-Path -LiteralPath $keyPath) -and (Test-Path -LiteralPath $crtPath)) { Write-Output 'Certificate pair already exists.'; exit 0 }
    throw 'Incomplete certificate pair. Refusing to overwrite.'
}
[void][IO.Directory]::CreateDirectory($OutDir)
$rsa = [Security.Cryptography.RSA]::Create(4096)
try {
    $req = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=LiveMotionComm', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('LiveMotionComm')
    $req.CertificateExtensions.Add($san.Build())
    $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
    $usage = [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign
    $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage,$true))
    $cert = $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddYears(1))
    [IO.File]::WriteAllText($keyPath,$rsa.ExportPkcs8PrivateKeyPem(),[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($crtPath,$cert.ExportCertificatePem(),[Text.UTF8Encoding]::new($false))
    Write-Output ('Created local certificate: '+$crtPath)
} finally { $rsa.Dispose() }
