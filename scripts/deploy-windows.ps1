#!/usr/bin/env powershell
# Bxc - Packaging and deployment script for Windows 11
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$DistDir = Join-Path $RepoRoot "dist\windows"
$ZipName = "bxc-windows-x64.zip"
$ZipPath = Join-Path $DistDir $ZipName

if (-not (Test-Path $ZipPath)) {
    Write-Error "Could not find bxc zip artifact at $ZipPath. Please run build-windows.ps1 first."
}

Write-Output "=== [1/3] Calculating SHA256 of bxc zip package ==="
$hashInfo = Get-FileHash -Path $ZipPath -Algorithm SHA256
$hashValue = $hashInfo.Hash.ToLower()
Write-Output "SHA256: $hashValue"

Write-Output ""
Write-Output "=== [2/3] Generating WinGet default manifest ==="
$PkgContent = Get-Content -Raw -Path (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
$Version = $PkgContent.version
Write-Output "Version resolved: $Version"

$ManifestPath = Join-Path $DistDir "Aphrody.Bxc.yaml"
$ManifestContent = @"
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.singleton.1.4.0.schema.json
PackageIdentifier: Aphrody.Bxc
PackageVersion: $Version
PackageName: Bxc Browser Automation
Publisher: Aphrody
License: Apache-2.0
ShortDescription: High-performance browser automation engine (Bun + Lightpanda + curl-impersonate).
Moniker: bxc
Tags:
  - browser
  - automation
  - crawl
  - scrape
  - ffi
Installers:
  - Architecture: x64
    InstallerType: portable
    InstallerUrl: https://github.com/aphrody-code/bxc/releases/download/v$Version/$ZipName
    InstallerSha256: $hashValue
ManifestType: singleton
ManifestVersion: 1.4.0
"@

[System.IO.File]::WriteAllText($ManifestPath, $ManifestContent)
Write-Output "WinGet manifest generated at: $ManifestPath"

Write-Output ""
Write-Output "=== [3/3] Checking MSIX Packaging (if AppxManifest exists) ==="
$AppxManifest = Join-Path $RepoRoot "AppxManifest.xml"
if (Test-Path $AppxManifest) {
    Write-Output "AppxManifest.xml found. Creating MSIX package..."
    $MsixPath = Join-Path $DistDir "bxc-windows-x64.msix"
    
    # Locate MakeAppx
    $MakeAppx = Get-Command "MakeAppx.exe" -ErrorAction SilentlyContinue
    if (-not $MakeAppx) {
        $sdkPaths = @(
            "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\MakeAppx.exe",
            "C:\Program Files (x86)\Windows Kits\10\App Certification Kit\MakeAppx.exe"
        )
        foreach ($path in $sdkPaths) {
            $matched = Resolve-Path $path -ErrorAction SilentlyContinue
            if ($matched) {
                $MakeAppx = $matched[0]
                break
            }
        }
    }
    
    if ($MakeAppx) {
        Write-Output "Found MakeAppx at: $MakeAppx"
        # Copy AppxManifest to dist\windows for packaging
        Copy-Item -Path $AppxManifest -Destination $DistDir -Force
        
        # We need an Assets folder for MSIX
        $AssetsDir = Join-Path $DistDir "Assets"
        $null = New-Item -ItemType Directory -Force -Path $AssetsDir
        
        # Write 1x1 transparent PNG to placeholders to pass AppxManifest validation
        $base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        $pngBytes = [System.Convert]::FromBase64String($base64Png)
        [System.IO.File]::WriteAllBytes((Join-Path $AssetsDir "Logo.png"), $pngBytes)
        [System.IO.File]::WriteAllBytes((Join-Path $AssetsDir "StoreLogo.png"), $pngBytes)
        [System.IO.File]::WriteAllBytes((Join-Path $AssetsDir "SmallLogo.png"), $pngBytes)

        # Package the MSIX app
        & $MakeAppx pack /d $DistDir /p $MsixPath /o
        Write-Output "MSIX Package created successfully at: $MsixPath"
    } else {
        Write-Output "MakeAppx.exe not found. MSIX packaging skipped (requires Windows SDK)."
    }
} else {
    Write-Output "No AppxManifest.xml at repo root. MSIX packaging skipped."
}

Write-Output ""
Write-Output "Deployment preparation completed!"
