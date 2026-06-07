# Get the directory of this script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Run the Bun bridge server
Write-Host "Starting bxc-bridge server on http://127.0.0.1:8765..." -ForegroundColor Green
bun run "$scriptDir/bxc-bridge.ts"
