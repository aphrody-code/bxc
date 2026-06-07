# Empaquette l'extension pour le Chrome Web Store.
# Exclut les fichiers meta/scripts qui ne doivent pas etre publies.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$out = Join-Path $root "bxc-gemini-tts-v$version.zip"
$staging = Join-Path $env:TEMP "bxc-gemini-tts-pkg"

# Fichiers/dossiers a inclure
$include = @("manifest.json", "service-worker.js", "content", "popup", "styles", "icons")

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $staging -Force | Out-Null
foreach ($item in $include) {
  $src = Join-Path $root $item
  if (Test-Path $src) { Copy-Item $src (Join-Path $staging $item) -Recurse -Force }
}
# Retirer les scripts .ps1 eventuellement copies (ex: icons/generate-icons.ps1)
Get-ChildItem $staging -Recurse -Filter *.ps1 | Remove-Item -Force -ErrorAction SilentlyContinue

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $out -Force
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "ZIP cree: $out ($size Ko)"
Write-Host "Exclus: CHROMEWEBSTORE.md, README.md, PRIVACY.md, *.ps1"
