#!/usr/bin/env powershell
# Bxc - Install dependencies on Windows 11 using winget
$ErrorActionPreference = "Stop"

Write-Output "=== [1/2] Installing global dependencies via winget ==="

# List of Winget packages to install
$packages = @(
    "Oven-sh.Bun",
    "zig.zig",
    "Git.Git",
    "Curl.Curl",
    "Rustlang.Rustup"
)

foreach ($pkg in $packages) {
    Write-Output "Installing $pkg..."
    & winget install -e --id $pkg --accept-source-agreements --accept-package-agreements --silent
}

Write-Output ""
Write-Output "=== [2/2] Installing Rust cross-compilation helpers ==="
if (Get-Command "cargo" -ErrorAction SilentlyContinue) {
    Write-Output "Installing cargo-xwin..."
    & cargo install cargo-xwin
} else {
    Write-Output "Warning: cargo not found in PATH. Please restart your shell to activate rustup, then run:"
    Write-Output "  cargo install cargo-xwin"
}

Write-Output ""
Write-Output "All dependencies installed successfully! Please restart your shell."
