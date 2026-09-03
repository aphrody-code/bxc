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
#   2. Downloads bxc-windows-<arch>.exe (or the .zip fallback) from GitHub
#   3. Installs it as %USERPROFILE%\.bxc\bin\bxc.exe
#   4. Writes the default configuration to %APPDATA%\bxc\config.json
#   5. Updates the user PATH so `bxc` is callable from any shell
#   6. Verifies install via `bxc --version`

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
  $Prefix = if ($Version -eq "latest") { "$BaseURL/latest/download" } else { "$BaseURL/download/$Version" }

  # Ordre des candidats : l'executable nu d'abord (c'est ce que publie
  # scripts/build-standalone.ts et ce que porte la release v0.8.0), l'archive
  # ensuite (scripts/build-windows.ts). Le premier telechargement qui aboutit
  # gagne — pas d'hypothese sur le format reellement publie.
  $CandidateNames = New-Object System.Collections.ArrayList
  foreach ($n in @("$Target.exe", "bxc-windows-$BunArch.exe", "$Target.zip", "bxc-windows-$BunArch.zip")) {
    if (-not $CandidateNames.Contains($n)) { $null = $CandidateNames.Add($n) }
  }

  function Get-Remote {
    param([String]$Url, [String]$OutFile, [bool]$NoCurl)
    Remove-Item -Force $OutFile -ErrorAction SilentlyContinue
    if (-not $NoCurl) {
      # `| Out-Null` : la sortie native d'un .exe part sinon dans le pipeline
      # et polluerait la valeur de retour de la fonction. Le try/catch neutralise
      # NativeCommandError, que PowerShell leve sur stderr quand
      # $ErrorActionPreference vaut "Stop" — un 404 attendu ne doit pas
      # interrompre la boucle de candidats.
      try {
        & curl.exe "-#SfLo" "$OutFile" "$Url" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $OutFile)) { return $true }
      } catch { }
    }
    try {
      Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -ErrorAction Stop | Out-Null
      return (Test-Path $OutFile)
    } catch {
      return $false
    }
  }

  $DownloadedPath = $null
  $DownloadedIsArchive = $false
  foreach ($name in $CandidateNames) {
    $url = "$Prefix/$name"
    $out = Join-Path $BxcBin $name
    Write-Output "Downloading $url ..."
    if (Get-Remote -Url $url -OutFile $out -NoCurl $DownloadWithoutCurl.IsPresent) {
      $DownloadedPath = $out
      $DownloadedIsArchive = $name.EndsWith(".zip")
      break
    }
  }

  if ($null -eq $DownloadedPath) {
    Write-Output "Install Failed — no release asset found for $Target (tried: $($CandidateNames -join ', '))"
    return 1
  }

  $ExePath = Join-Path $BxcBin "bxc.exe"

  if ($DownloadedIsArchive) {
    try {
      $lastProgressPreference = $global:ProgressPreference
      $global:ProgressPreference = 'SilentlyContinue'
      $Extract = Join-Path $BxcBin "_extract"
      Remove-Item -Recurse -Force $Extract -ErrorAction SilentlyContinue
      Expand-Archive $DownloadedPath $Extract -Force
      $global:ProgressPreference = $lastProgressPreference

      $Found = Get-ChildItem -Path $Extract -Filter "bxc.exe" -Recurse | Select-Object -First 1
      if ($null -eq $Found) {
        Write-Output "Install Failed — bxc.exe not found inside $DownloadedPath"
        return 1
      }
      Move-Item $Found.FullName $ExePath -Force
      Remove-Item -Recurse -Force $Extract -ErrorAction SilentlyContinue
    } catch {
      Write-Output "Install Failed — could not extract $DownloadedPath"
      Write-Error $_
      return 1
    } finally {
      Remove-Item -Force $DownloadedPath -ErrorAction SilentlyContinue
    }
  } elseif ($DownloadedPath -ne $ExePath) {
    # Un .exe en cours d'execution ne peut pas etre ecrase, mais il peut etre
    # renomme : on decale l'ancien avant de mettre le neuf en place.
    if (Test-Path $ExePath) {
      $Backup = "$ExePath.old-$(Get-Date -Format 'yyyyMMddHHmmss')"
      try { Move-Item $ExePath $Backup -Force } catch { }
      Remove-Item -Force $Backup -ErrorAction SilentlyContinue
    }
    Move-Item $DownloadedPath $ExePath -Force
  }

  if (-not (Test-Path $ExePath)) {
    Write-Output "Install Failed — bxc.exe not found in $BxcBin after install"
    return 1
  }

  # ─── Configuration par defaut (%APPDATA%\bxc\config.json) ─────────────

  $AppData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $Home "AppData\Roaming" }
  $ConfigDir = if ($env:BXC_CONFIG_DIR) { $env:BXC_CONFIG_DIR } else { Join-Path $AppData "bxc" }
  $null = New-Item -ItemType Directory -Force -Path $ConfigDir
  $ConfigPath = Join-Path $ConfigDir "config.json"
  if (-not (Test-Path $ConfigPath)) {
    $Config = [ordered]@{
      rootDir       = $BxcRoot
      installDir    = $BxcBin
      releaseRepo   = "aphrody-code/bxc"
      lightpandaTag = "nightly"
      timeoutMs     = 30000
    }
    # UTF-8 SANS BOM : Windows PowerShell 5.1 ecrit un BOM avec `-Encoding UTF8`
    # et `JSON.parse` s'etrangle dessus. WriteAllText sans BOM marche partout.
    [System.IO.File]::WriteAllText($ConfigPath, ($Config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "Configuration written to $ConfigPath"
  } else {
    Write-Output "Existing configuration kept: $ConfigPath"
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
    & $ExePath --version
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "bxc.exe --version exited with $LASTEXITCODE."
    }
  } catch {
    Write-Warning "Could not run bxc.exe — see error above. Open a new shell and try again."
  }

  Write-Output ""
  Write-Output "Get started:"
  Write-Output "  bxc --help"
  Write-Output "  bxc recon https://example.com"
  Write-Output "  bxc self-update --check   # verifie les mises a jour sans rien ecrire"
  Write-Output ""
  Write-Output "Docs: https://github.com/aphrody-code/bxc"
}

Install-Bxc -Version $Version -ForceBaseline $ForceBaseline.IsPresent
