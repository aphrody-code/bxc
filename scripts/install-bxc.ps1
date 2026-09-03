#!/usr/bin/env pwsh
# DEPRECIE — conserve pour ne pas casser les liens existants.
#
# L'installeur Windows canonique est `install.ps1`, a la racine du depot :
# il gere l'executable nu ET l'archive, ecrit la configuration par defaut sous
# %APPDATA%\bxc, met a jour le PATH utilisateur et verifie l'installation.
#
#   irm https://raw.githubusercontent.com/aphrody-code/bxc/main/install.ps1 | iex
#
# Ce fichier se contente de rediriger vers lui, avec les memes parametres.

param(
  [String]$Version = "latest",
  [Switch]$ForceBaseline = $false,
  [Switch]$NoPathUpdate = $false,
  [Switch]$DownloadWithoutCurl = $false
)

$ErrorActionPreference = "Stop"

Write-Warning "scripts/install-bxc.ps1 est deprecie — utilisez install.ps1 a la racine du depot."

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$Canonical = Join-Path $RepoRoot "install.ps1"

if (Test-Path $Canonical) {
  & $Canonical -Version $Version -ForceBaseline:$ForceBaseline -NoPathUpdate:$NoPathUpdate -DownloadWithoutCurl:$DownloadWithoutCurl
  exit $LASTEXITCODE
}

Write-Output "install.ps1 introuvable localement — telechargement depuis GitHub..."
$Remote = "https://raw.githubusercontent.com/aphrody-code/bxc/main/install.ps1"
Invoke-Expression ((Invoke-WebRequest -Uri $Remote -UseBasicParsing).Content)
