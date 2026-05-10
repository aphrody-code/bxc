# 06b — Agent `dist-install-cmd`

**Phase** : 4
**Subagent type** : `typescript-pro`
**Durée estimée** : 1.5h

## Mission

(1) Créer `bunlight install` CLI subcommand qui télécharge tous les binaires nécessaires (Lightpanda, Chrome for Testing, Camoufox optionnel).
(2) Étendre `scripts/postinstall.ts` pour appeler `bunlight install` automatiquement après `npm install -g @bunmium/bunlight`.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/scripts/postinstall.ts` (existant — auto-download Lightpanda)
3. `~/bunmium/agent-browser/cli/src/native/install.rs` (ou équivalent — modèle agent-browser install)
4. `bunlight/src/cli/serve.ts` (CLI entry)

## Scope strict

**Touche** :
- `bunlight/src/cli/install.ts` (à créer — sous-commande `install`)
- `bunlight/src/cli/index.ts` (router de sous-commandes — création/modif)
- `bunlight/scripts/postinstall.ts` (extension)
- `bunlight/bin/bunlight` (wrapper bash — vérifier qu'il route vers `src/cli/index.ts`)
- `bunlight/README.md` (section "Installation")

**NE TOUCHE PAS** : code domains, profiles, transports.

## Tâche 1 — `bunlight install`

`src/cli/install.ts` :

```ts
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface InstallOptions {
  withCamoufox?: boolean;
  withChromium?: boolean;
}

const VENDOR_DIR = process.env.BUNLIGHT_VENDOR_DIR ?? join(homedir(), ".bunlight", "vendor");

async function downloadFile(url: string, destPath: string): Promise<void> {
  await mkdir(join(destPath, ".."), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to download ${url}: ${r.status}`);
  await Bun.write(destPath, r);
}

async function installLightpanda() {
  const platform = `${process.platform}-${process.arch}`;
  const url = `https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-${platform === "linux-x64" ? "x86_64-linux" : "aarch64-macos"}`;
  const dest = join(VENDOR_DIR, "lightpanda-bin", platform, "lightpanda");
  if (existsSync(dest) && (await Bun.file(dest).size) > 0) {
    console.log(`Lightpanda already installed at ${dest}`);
    return;
  }
  console.log(`Downloading Lightpanda from ${url}...`);
  await downloadFile(url, dest);
  await Bun.$`chmod +x ${dest}`;
  console.log(`Installed Lightpanda at ${dest}`);
}

async function installChromium() {
  // Chrome for Testing — comme agent-browser install
  const platform = `${process.platform}-${process.arch}`;
  const version = "131.0.6778.85"; // pin
  // ... fetch latest known good, unzip, store dans VENDOR_DIR/chromium/
  console.log(`Chromium install: TODO`);
}

async function installCamoufox() {
  // Camoufox v135 download — gros (1.9 GB)
  console.log(`Camoufox install: TODO (1.9 GB download)`);
}

export async function runInstall(options: InstallOptions) {
  await installLightpanda();
  if (options.withChromium) await installChromium();
  if (options.withCamoufox) await installCamoufox();
}

// CLI entry
if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: InstallOptions = {
    withChromium: args.includes("--with-chromium") || args.includes("--all"),
    withCamoufox: args.includes("--with-camoufox") || args.includes("--all"),
  };
  await runInstall(options);
}
```

Usage :
- `bunlight install` — Lightpanda only (défaut, léger ~100 MB)
- `bunlight install --with-chromium` — + Chrome for Testing (300 MB)
- `bunlight install --with-camoufox` — + Camoufox (1.9 GB)
- `bunlight install --all` — tout

## Tâche 2 — `src/cli/index.ts` router

```ts
const subcommand = process.argv[2];

switch (subcommand) {
  case "serve":
    await import("./serve.ts").then(m => m.main(process.argv.slice(3)));
    break;
  case "install":
    await import("./install.ts").then(m => m.main(process.argv.slice(3)));
    break;
  case "--version":
  case "-V":
    console.log(`bunlight ${require("../../package.json").version}`);
    break;
  case "--help":
  case "-h":
  default:
    console.log(`bunlight — Bun-native browser engine
Usage:
  bunlight serve --cdp-port <N> --profile <P>
  bunlight install [--with-chromium] [--with-camoufox] [--all]
  bunlight --version
`);
}
```

## Tâche 3 — postinstall extension

`scripts/postinstall.ts` étendu :
- Le comportement actuel (auto-download Lightpanda) reste.
- Si `BUNLIGHT_INSTALL_PROFILES=stealth,max` env var set, télécharge aussi Chromium / Camoufox.
- Idempotent comme avant.

## README update

Ajouter section "Installation" :
```markdown
## Installation

### Global (recommended)
npm install -g @bunmium/bunlight
bunlight install                  # downloads Lightpanda
bunlight install --with-chromium  # for stealth profile
bunlight install --all            # everything (1.9 GB)

### Standalone executable
curl -L https://github.com/bunmium/bunlight/releases/latest/download/bunlight-linux-x64 -o /usr/local/bin/bunlight
chmod +x /usr/local/bin/bunlight
bunlight install
```

## Verification

```bash
# Clean install simulation
rm -rf ~/.bunlight/vendor
bun run src/cli/index.ts install
ls ~/.bunlight/vendor/lightpanda-bin/  # should have linux-x64 binary
```

## Done condition

- `bunlight install` working
- Subcommand router en place
- postinstall.ts étendu
- README install section
- state.md §4
- status.json 06b → `completed`
