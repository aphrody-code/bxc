#!/usr/bin/env pwsh
# Bxc installer — Windows PowerShell.
# Inspired by https://bun.sh/install.ps1.
#
# Usage:
#   irm bxc.dev/install.ps1 | iex
#   irm https://raw.githubusercontent.com/aphrody-code/bxc/main/install.ps1 | iex
#
# Flags (via -arg):
#   -Version <semver>     Specific version (default: latest)
#   -ForceBaseline        Force the baseline build (pre-AVX2 CPUs)
#   -NoPathUpdate         Skip adding the bxc bin dir to %PATH%
#   -DownloadWithoutCurl  Use Invoke-RestMethod instead of curl.exe
#
# What it does:
#   1. Detects Windows + AMD64/ARM64 architecture from the registry
#   2. Downloads bxc-windows-<arch>.zip from GitHub releases
#   3. Extracts to %USERPROFILE%\.bxc\bin\
#   4. Updates the user PATH so `bxc` is callable from any shell
#   5. Verifies install via `bxc --version`

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
  Write-Output "Bxc for Windows is only available for x86 64-bit and ARM64 Windows.`n"
  return 1
}

# Same Windows version floor as Bun (the runtime we depend on).
$MinBuild = 17763
$MinBuildName = "Windows 10 1809 / Windows Server 2019"

$WinVer = [System.Environment]::OSVersion.Version
if ($WinVer.Major -lt 10 -or ($WinVer.Major -eq 10 -and $WinVer.Build -lt $MinBuild)) {
  Write-Warning "Bxc requires at least ${MinBuildName} or newer.`nThe install will continue but may not work."
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

function Install-Bxc {
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

  $BxcRoot = if ($env:BXC_INSTALL) { $env:BXC_INSTALL } else { "${Home}\.bxc" }
  $BxcBin = "${BxcRoot}\bin"
  $null = New-Item -ItemType Directory -Force -Path $BxcBin

  $Target = "bxc-windows-$BunArch"
  if ($IsBaseline) {
    $Target = "bxc-windows-$BunArch-baseline"
  }

  $BaseURL = "https://github.com/aphrody-code/bxc/releases"
  $URL = if ($Version -eq "latest") {
    "$BaseURL/latest/download/$Target.zip"
  } else {
    "$BaseURL/download/$Version/$Target.zip"
  }

  $ZipPath = "${BxcBin}\$Target.zip"
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
    Expand-Archive "$ZipPath" "$BxcBin" -Force
    $global:ProgressPreference = $lastProgressPreference

    if (Test-Path "${BxcBin}\$Target\bxc.exe") {
      Move-Item "${BxcBin}\$Target\bxc.exe" "${BxcBin}\bxc.exe" -Force
      Remove-Item -Recurse -Force "${BxcBin}\$Target" -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Output "Install Failed — could not extract $ZipPath"
    Write-Error $_
    return 1
  } finally {
    Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path "${BxcBin}\bxc.exe")) {
    Write-Output "Install Failed — bxc.exe not found in $BxcBin after extract"
    return 1
  }

  # ─── PATH update ────────────────────────────────────────────────────

  if (-not $NoPathUpdate) {
    $UserPath = Get-Env "PATH"
    $PathSeparator = ";"
    $PathItems = $UserPath -split $PathSeparator | Where-Object { $_ -ne $BxcBin }
    if ($PathItems -notcontains $BxcBin) {
      $NewPath = (@($BxcBin) + $PathItems) -join $PathSeparator
      Write-Env -Key "PATH" -Value $NewPath
      $env:PATH = $NewPath
      Write-Output "Added $BxcBin to user PATH."
    } else {
      Write-Output "$BxcBin is already on user PATH."
    }
  }

  # ─── Verify ────────────────────────────────────────────────────────

  Write-Output ""
  Write-Output "Bxc installed at ${BxcBin}\bxc.exe"
  Write-Output ""

  try {
    & "${BxcBin}\bxc.exe" --version
  } catch {
    Write-Warning "Could not run bxc.exe — see error above. Open a new shell and try again."
  }

  Write-Output ""
  Write-Output "Get started:"
  Write-Output "  bxc serve --cdp-port 9222"
  Write-Output "  bxc scrape https://example.com"
  Write-Output "  bxc --help"
  Write-Output ""
  Write-Output "Docs: https://github.com/aphrody-code/bxc"
}

Install-Bxc -Version $Version -ForceBaseline $ForceBaseline.IsPresent
