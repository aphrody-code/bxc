#!/usr/bin/env pwsh
# Bxc — native Windows build orchestrator (no WSL, no MSYS2).
#
# Inspired by https://bun.com/docs/project/building-windows.
# Runs on a real Windows host. For cross-compilation from Linux/macOS,
# use scripts/build-standalone.ts instead (target=bun-windows-x64).
#
# Pipeline:
#   1. Verify prerequisites (Bun, Zig, MSVC build tools, git)
#   2. Build the Lightpanda browser engine natively (Zig cross-compile,
#      x86_64-windows-gnu target, no MSYS2 needed).
#   3. Build the bxc standalone executable (bun build --compile
#      --target=bun-windows-x64).
#   4. Optionally fetch curl-impersonate Windows DLL (lexiforest releases).
#   5. Bundle bxc.exe + lightpanda.exe + curl-impersonate.dll into
#      a single zip ready for `bxc-windows-x64.zip` GitHub release.
#
# Usage:
#   .\scripts\build-windows.ps1                  # full build
#   .\scripts\build-windows.ps1 -SkipLightpanda  # skip Lightpanda step
#   .\scripts\build-windows.ps1 -Baseline        # pre-AVX2 CPU compat
#   .\scripts\build-windows.ps1 -Arch arm64      # ARM64 build (experimental)
#
# Outputs:
#   dist\windows\bxc.exe
#   dist\windows\lightpanda.exe
#   dist\windows\libcurl-impersonate.dll
#   dist\windows\bxc-windows-x64.zip
#
# Note on Lightpanda:
#   Upstream lightpanda-io/browser is an Alpha-stage Zig project with V8
#   bindings. Native Windows is currently unofficial — see
#   https://github.com/lightpanda-io/browser/issues for status. We compile
#   it via `zig build -Dtarget=x86_64-windows-gnu -Doptimize=ReleaseFast`,
#   which uses Zig's hermetic linker and does NOT require MSVC, MSYS2 or
#   WSL. If V8 prebuilts for windows-gnu are missing, the script falls
#   back to lexiforest pre-built binaries when available.

param(
  [String]$Arch = "x64",
  [Switch]$Baseline = $false,
  [Switch]$SkipLightpanda = $false,
  [Switch]$SkipCurl = $false,
  [String]$LightpandaRef = "main",
  [String]$ZigVersion = "0.14.0",
  [String]$CurlVersion = "v1.5.6"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

# ─── Prerequisites ─────────────────────────────────────────────────────

function Assert-Cmd {
  param([String]$Cmd, [String]$InstallHint)
  if (-not (Get-Command $Cmd -ErrorAction SilentlyContinue)) {
    Write-Output "Missing prerequisite: $Cmd"
    Write-Output "  Install hint: $InstallHint"
    exit 1
  }
}

Write-Output "[1/5] Checking prerequisites..."
Assert-Cmd "bun" "winget install Oven-sh.Bun  (or  irm bun.sh/install.ps1 | iex)"
Assert-Cmd "git" "winget install Git.Git"
Assert-Cmd "zig" "winget install zig.zig --version $ZigVersion  (or download from https://ziglang.org/download/)"

$BunArch = if ($Arch -eq "arm64") { "aarch64" } else { "x64" }
$ZigTarget = if ($Arch -eq "arm64") { "aarch64-windows-gnu" } else { "x86_64-windows-gnu" }
$BunTarget = if ($Baseline) { "bun-windows-${BunArch}-baseline" } else { "bun-windows-${BunArch}" }

Write-Output "  bun       $(bun --version)"
Write-Output "  zig       $(zig version)"
Write-Output "  target    $ZigTarget / $BunTarget"

$DistDir = Join-Path $RepoRoot "dist\windows"
$null = New-Item -ItemType Directory -Force -Path $DistDir

# ─── Step 2: Lightpanda native build (Zig cross-compile) ──────────────

if (-not $SkipLightpanda) {
  Write-Output ""
  Write-Output "[2/5] Building Lightpanda (Zig cross-compile, x86_64-windows-gnu)..."

  $LightpandaSrc = Join-Path $RepoRoot "vendor\lightpanda-src"
  if (-not (Test-Path $LightpandaSrc)) {
    Write-Output "  cloning lightpanda-io/browser@${LightpandaRef} ..."
    git clone --depth 1 --branch $LightpandaRef https://github.com/lightpanda-io/browser.git $LightpandaSrc
  } else {
    Write-Output "  vendor/lightpanda-src already present — pulling latest ..."
    Push-Location $LightpandaSrc
    git fetch origin $LightpandaRef
    git checkout $LightpandaRef
    git pull --ff-only origin $LightpandaRef
    Pop-Location
  }

  Push-Location $LightpandaSrc
  try {
    Write-Output "  zig build -Dtarget=$ZigTarget -Doptimize=ReleaseFast ..."
    & zig build "-Dtarget=$ZigTarget" -Doptimize=ReleaseFast 2>&1 | Tee-Object -Variable ZigOutput

    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Native Lightpanda build failed. This is expected on Alpha — falling back to release binary if available."

      $LightpandaRelease = "https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-${ZigTarget}.exe"
      $FallbackOut = Join-Path $DistDir "lightpanda.exe"
      Write-Output "  fetching fallback prebuilt: $LightpandaRelease"

      try {
        curl.exe "-#SfLo" $FallbackOut $LightpandaRelease
        if ($LASTEXITCODE -ne 0) { throw "curl returned $LASTEXITCODE" }
      } catch {
        Invoke-RestMethod -Uri $LightpandaRelease -OutFile $FallbackOut
      }

      if (-not (Test-Path $FallbackOut)) {
        Write-Warning "Lightpanda not available for $ZigTarget — bxc will run without Lightpanda support on this build."
      }
    } else {
      $BuiltExe = Join-Path $LightpandaSrc "zig-out\bin\lightpanda.exe"
      if (Test-Path $BuiltExe) {
        Copy-Item $BuiltExe (Join-Path $DistDir "lightpanda.exe") -Force
        Write-Output "  OK lightpanda.exe -> $DistDir"
      } else {
        Write-Warning "Zig build succeeded but lightpanda.exe not found at zig-out\bin\"
      }
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Output ""
  Write-Output "[2/5] Skipped Lightpanda build (-SkipLightpanda)"
}

# ─── Step 3: Bxc standalone (bun build --compile) ────────────────

Write-Output ""
Write-Output "[3/5] Building bxc standalone executable (target=$BunTarget)..."

Push-Location $RepoRoot
try {
  if (-not (Test-Path "node_modules")) {
    Write-Output "  bun install --frozen-lockfile ..."
    & bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
  }

  $OutExe = Join-Path $DistDir "bxc.exe"
  $BuildArgs = @(
    "build", "src/cli/index.ts",
    "--compile", "--target=$BunTarget",
    "--minify", "--sourcemap=linked", "--bytecode",
    "--external", "electron",
    "--external", "playwright-core/lib/zipBundle",
    "--define", "BUILD_VERSION=`"$(jq -r .version package.json)`"",
    "--define", "BUILD_TIME=`"$(Get-Date -Format 'o')`"",
    "--outfile", $OutExe
  )

  Write-Output "  bun $($BuildArgs -join ' ')"
  & bun @BuildArgs

  if ($LASTEXITCODE -ne 0) { throw "bun build --compile failed" }

  $size = [math]::Round((Get-Item $OutExe).Length / 1MB, 2)
  Write-Output "  OK bxc.exe ($size MB) -> $DistDir"
} finally {
  Pop-Location
}

# ─── Step 4: curl-impersonate DLL ─────────────────────────────────────

if (-not $SkipCurl) {
  Write-Output ""
  Write-Output "[4/5] Fetching curl-impersonate Windows DLL ($CurlVersion)..."

  $CurlAsset = "libcurl-impersonate-$CurlVersion.x86_64-win64.zip"
  $CurlURL = "https://github.com/lexiforest/curl-impersonate/releases/download/$CurlVersion/$CurlAsset"
  $TmpZip = Join-Path $env:TEMP $CurlAsset

  try {
    curl.exe "-#SfLo" $TmpZip $CurlURL
    if ($LASTEXITCODE -ne 0) { throw "curl returned $LASTEXITCODE" }
  } catch {
    try {
      Invoke-RestMethod -Uri $CurlURL -OutFile $TmpZip
    } catch {
      Write-Warning "Could not download curl-impersonate Windows DLL ($CurlURL)."
      Write-Warning "The bxc.exe will lack TLS-fingerprint http profile on Windows."
      $SkipCurl = $true
    }
  }

  if (-not $SkipCurl -and (Test-Path $TmpZip)) {
    $TmpExtract = Join-Path $env:TEMP "curl-impersonate-extract"
    Remove-Item -Recurse -Force $TmpExtract -ErrorAction SilentlyContinue
    Expand-Archive $TmpZip $TmpExtract -Force

    $Dll = Get-ChildItem -Path $TmpExtract -Filter "libcurl-impersonate*.dll" -Recurse | Select-Object -First 1
    if ($Dll) {
      Copy-Item $Dll.FullName (Join-Path $DistDir "libcurl-impersonate.dll") -Force
      Write-Output "  OK libcurl-impersonate.dll -> $DistDir"
    } else {
      Write-Warning "DLL not found inside $TmpZip — skipping."
    }

    Remove-Item -Recurse -Force $TmpExtract -ErrorAction SilentlyContinue
    Remove-Item -Force $TmpZip -ErrorAction SilentlyContinue
  }
} else {
  Write-Output ""
  Write-Output "[4/5] Skipped curl-impersonate fetch (-SkipCurl)"
}

# ─── Step 5: Bundle into release zip ──────────────────────────────────

Write-Output ""
Write-Output "[5/5] Bundling release zip..."

$ZipName = if ($Baseline) { "bxc-windows-${BunArch}-baseline.zip" } else { "bxc-windows-${BunArch}.zip" }
$ZipPath = Join-Path $DistDir $ZipName

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

$ToBundle = @()
foreach ($file in @("bxc.exe", "lightpanda.exe", "libcurl-impersonate.dll")) {
  $p = Join-Path $DistDir $file
  if (Test-Path $p) { $ToBundle += $p }
}

if ($ToBundle.Count -eq 0) {
  Write-Output "FAIL — no artifacts to bundle"
  exit 1
}

Compress-Archive -Path $ToBundle -DestinationPath $ZipPath -Force
$zipSize = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Output "  OK $ZipName ($zipSize MB)"
Write-Output ""
Write-Output "Done. Artifacts in $DistDir :"
Get-ChildItem $DistDir | ForEach-Object {
  $sz = [math]::Round($_.Length / 1MB, 2)
  Write-Output ("  {0,-40} {1,8} MB" -f $_.Name, $sz)
}
Write-Output ""
Write-Output "Upload via:"
Write-Output "  gh release create v$(jq -r .version package.json) $ZipPath --generate-notes"
