# Bxc Windows Installer
$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:USERPROFILE ".bxc\bin"
if (-not (Test-Path $InstallDir)) {
    $null = New-Item -ItemType Directory -Force -Path $InstallDir
}

Write-Output "Resolving latest Bxc version..."
$PkgUrl = "https://raw.githubusercontent.com/aphrody-code/bxc/main/package.json"
$Pkg = Invoke-RestMethod -Uri $PkgUrl
$Version = $Pkg.version
Write-Output "Latest version: v$Version"

$ZipUrl = "https://github.com/aphrody-code/bxc/releases/download/v$Version/bxc-windows-x64.zip"
$ZipPath = Join-Path $InstallDir "bxc.zip"

Write-Output "Downloading Bxc..."
& curl -#SfLo $ZipPath $ZipUrl

Write-Output "Extracting Bxc..."
Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
Remove-Item -Path $ZipPath -Force

# Add to User PATH if not already present
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Output "Adding $InstallDir to user PATH..."
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path += ";$InstallDir"
}

Write-Output "Bxc installed successfully to $InstallDir!"
Write-Output "Restart your terminal and run 'bxc --version' to get started."
