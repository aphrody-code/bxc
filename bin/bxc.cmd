@echo off
REM bxc — point d'entree cmd.exe / PowerShell.
REM
REM Utile quand le depot est clone et que `bin\` est ajoute au PATH : le shim
REM genere par `bun install -g` couvre deja le cas d'une installation globale.
REM Delegue toute la logique a bin\bxc.mjs (choix du binaire standalone, repli
REM sur les sources) pour n'avoir qu'une seule implementation a maintenir.

setlocal
set "BXC_BIN_DIR=%~dp0"

if defined BUN_BIN (
  "%BUN_BIN%" "%BXC_BIN_DIR%bxc.mjs" %*
  exit /b %ERRORLEVEL%
)

where bun.exe >nul 2>nul
if errorlevel 1 (
  echo bxc: "bun" introuvable dans le PATH. Installez Bun : https://bun.sh 1>&2
  exit /b 127
)

bun.exe "%BXC_BIN_DIR%bxc.mjs" %*
exit /b %ERRORLEVEL%
