#!/usr/bin/env pwsh
# Bunlight installer — Windows PowerShell.
# Inspired by https://bun.sh/install.ps1.
#
# Usage:
#   irm bunlight.dev/install.ps1 | iex
#   irm https://raw.githubusercontent.com/aphrody-code/bunlight/main/install.ps1 | iex
#
# Flags (via -arg):
#   -Version <semver>     Specific version (default: latest)
#   -ForceBaseline        Force the baseline build (pre-AVX2 CPUs)
#   -NoPathUpdate         Skip adding the bunlight bin dir to %PATH%
#   -DownloadWithoutCurl  Use Invoke-RestMethod instead of curl.exe
#
# What it does:
#   1. Detects Windows + AMD64/ARM64 architecture from the registry
#   2. Downloads bunlight-windows-<arch>.zip from GitHub releases
#   3. Extracts to %USERPROFILE%\.bunlight\bin\
#   4. Updates the user PATH so `bunlight` is callable from any shell
#   5. Verifies install via `bunlight --version`

param(
  [String]$Version = "latest",
  [Switch]$ForceBaseline = $false,
  [Switch]$NoPathUpdate = $false,
  [Switch]$DownloadWithoutCurl = $false
)

$ErrorActionPreference = "Stop"

# ─── Architecture detection ─────────────────────────────────────────────

$Arch = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE
if (-not ($Arch -eq "AMD64" -or $Arch -eq "ARM64")) {
  Write-Output "Install Failed:"
  Write-Output "Bunlight for Windows is only available for x86 64-bit and ARM64 Windows.`n"
  return 1
}

# Same Windows version floor as Bun (the runtime we depend on).
$MinBuild = 17763
$MinBuildName = "Windows 10 1809 / Windows Server 2019"

$WinVer = [System.Environment]::OSVersion.Version
if ($WinVer.Major -lt 10 -or ($WinVer.Major -eq 10 -and $WinVer.Build -lt $MinBuild)) {
  Write-Warning "Bunlight requires at least ${MinBuildName} or newer.`nThe install will continue but may not work."
}

# ─── PATH helpers (copied pattern from Bun installer) ───────────────────

function Publish-Env {
  if (-not ("Win32.NativeMethods" -as [Type])) {
    Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
  }
  $HWND_BROADCAST = [IntPtr] 0xffff
  $WM_SETTINGCHANGE = 0x1a
  $result = [UIntPtr]::Zero
  [Win32.NativeMethods]::SendMessageTimeout(
    $HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, "Environment",
    2, 5000, [ref] $result
  ) | Out-Null
}

function Write-Env {
  param([String]$Key, [String]$Value)

  $RegisterKey = Get-Item -Path 'HKCU:'
  $EnvRegisterKey = $RegisterKey.OpenSubKey('Environment', $true)
  if ($null -eq $Value) {
    $EnvRegisterKey.DeleteValue($Key)
  } else {
    $RegistryValueKind = if ($Value.Contains('%')) {
      [Microsoft.Win32.RegistryValueKind]::ExpandString
    } elseif ($EnvRegisterKey.GetValue($Key)) {
      $EnvRegisterKey.GetValueKind($Key)
    } else {
      [Microsoft.Win32.RegistryValueKind]::String
    }
    $EnvRegisterKey.SetValue($Key, $Value, $RegistryValueKind)
  }
  Publish-Env
}

function Get-Env {
  param([String] $Key)
  $RegisterKey = Get-Item -Path 'HKCU:'
  $EnvRegisterKey = $RegisterKey.OpenSubKey('Environment')
  $EnvRegisterKey.GetValue($Key, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

# ─── Install ────────────────────────────────────────────────────────────

function Install-Bunlight {
  param(
    [string]$Version,
    [bool]$ForceBaseline = $false
  )

  if ($Version -match "^\d+\.\d+\.\d+(-[\w\.]+)?$") {
    $Version = "v$Version"
  }

  $IsARM64 = $Arch -eq "ARM64"
  $BunArch = if ($IsARM64) { "aarch64" } else { "x64" }

  $IsBaseline = $false
  if (-not $IsARM64) {
    $IsBaseline = $ForceBaseline
    if (-not $IsBaseline) {
      $IsBaseline = -not (
        Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);' `
          -Name 'Kernel32' -Namespace 'Win32' -PassThru
      )::IsProcessorFeaturePresent(40)
    }
  }

  $BunlightRoot = if ($env:BUNLIGHT_INSTALL) { $env:BUNLIGHT_INSTALL } else { "${Home}\.bunlight" }
  $BunlightBin = "${BunlightRoot}\bin"
  $null = New-Item -ItemType Directory -Force -Path $BunlightBin

  $Target = "bunlight-windows-$BunArch"
  if ($IsBaseline) {
    $Target = "bunlight-windows-$BunArch-baseline"
  }

  $BaseURL = "https://github.com/aphrody-code/bunlight/releases"
  $URL = if ($Version -eq "latest") {
    "$BaseURL/latest/download/$Target.zip"
  } else {
    "$BaseURL/download/$Version/$Target.zip"
  }

  $ZipPath = "${BunlightBin}\$Target.zip"
  Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue

  Write-Output "Downloading $URL ..."

  if (-not $DownloadWithoutCurl) {
    curl.exe "-#SfLo" "$ZipPath" "$URL"
  }
  if ($DownloadWithoutCurl -or ($LASTEXITCODE -ne 0)) {
    Write-Warning "curl.exe failed (exit ${LASTEXITCODE}) — trying Invoke-RestMethod ..."
    try {
      Invoke-RestMethod -Uri $URL -OutFile $ZipPath
    } catch {
      Write-Output "Install Failed — could not download $URL"
      return 1
    }
  }

  if (-not (Test-Path $ZipPath)) {
    Write-Output "Install Failed — $ZipPath does not exist (antivirus interference?)"
    return 1
  }

  try {
    $lastProgressPreference = $global:ProgressPreference
    $global:ProgressPreference = 'SilentlyContinue'
    Expand-Archive "$ZipPath" "$BunlightBin" -Force
    $global:ProgressPreference = $lastProgressPreference

    if (Test-Path "${BunlightBin}\$Target\bunlight.exe") {
      Move-Item "${BunlightBin}\$Target\bunlight.exe" "${BunlightBin}\bunlight.exe" -Force
      Remove-Item -Recurse -Force "${BunlightBin}\$Target" -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Output "Install Failed — could not extract $ZipPath"
    Write-Error $_
    return 1
  } finally {
    Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path "${BunlightBin}\bunlight.exe")) {
    Write-Output "Install Failed — bunlight.exe not found in $BunlightBin after extract"
    return 1
  }

  # ─── PATH update ────────────────────────────────────────────────────

  if (-not $NoPathUpdate) {
    $UserPath = Get-Env "PATH"
    $PathSeparator = ";"
    $PathItems = $UserPath -split $PathSeparator | Where-Object { $_ -ne $BunlightBin }
    if ($PathItems -notcontains $BunlightBin) {
      $NewPath = (@($BunlightBin) + $PathItems) -join $PathSeparator
      Write-Env -Key "PATH" -Value $NewPath
      $env:PATH = $NewPath
      Write-Output "Added $BunlightBin to user PATH."
    } else {
      Write-Output "$BunlightBin is already on user PATH."
    }
  }

  # ─── Verify ────────────────────────────────────────────────────────

  Write-Output ""
  Write-Output "Bunlight installed at ${BunlightBin}\bunlight.exe"
  Write-Output ""

  try {
    & "${BunlightBin}\bunlight.exe" --version
  } catch {
    Write-Warning "Could not run bunlight.exe — see error above. Open a new shell and try again."
  }

  Write-Output ""
  Write-Output "Get started:"
  Write-Output "  bunlight serve --cdp-port 9222"
  Write-Output "  bunlight scrape https://example.com"
  Write-Output "  bunlight --help"
  Write-Output ""
  Write-Output "Docs: https://github.com/aphrody-code/bunlight"
}

Install-Bunlight -Version $Version -ForceBaseline $ForceBaseline.IsPresent
