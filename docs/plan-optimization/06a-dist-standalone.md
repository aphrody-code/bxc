# 06a — Agent `dist-standalone`

**Phase** : 4
**Subagent type** : `bun-deployer`
**Durée estimée** : 1.5h

## Mission

Étendre `scripts/build-standalone.ts` pour produire 4 standalone executables (linux x64/arm64, darwin x64/arm64) via `bun build --compile --target=bun-<platform>`.

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/scripts/build-standalone.ts` (existant)
3. `bunlight/package.json` `files` whitelist
4. https://bun.com/docs/bundler/executables (cross-compilation Bun)

## Scope strict

**Touche** :
- `bunlight/scripts/build-standalone.ts`
- `bunlight/.github/workflows/release.yml` (ou équivalent CI matrix — création si besoin)
- `bunlight/CHANGELOG.md` (entrée 0.2.0)
- `bunlight/dist/standalone/` (output des builds, gitignored)

**NE TOUCHE PAS** : code source, tests.

## Implementation

`scripts/build-standalone.ts` étendu :

```ts
import { spawn } from "bun";
import { mkdir } from "node:fs/promises";

const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
];

const ENTRY = "src/cli/serve.ts";

await mkdir("dist/standalone", { recursive: true });

const results: { target: string; ok: boolean; sizeMB: number; error?: string }[] = [];

for (const target of TARGETS) {
  const platform = target.replace("bun-", "");
  const outfile = `dist/standalone/bunlight-${platform}`;

  const proc = spawn({
    cmd: [
      "bun", "build", ENTRY,
      "--compile",
      "--target", target,
      "--minify",
      "--outfile", outfile,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode === 0) {
    const stat = await Bun.file(outfile).size;
    results.push({ target, ok: true, sizeMB: stat / 1e6 });
    console.log(`OK ${target}: ${(stat / 1e6).toFixed(1)} MB`);
  } else {
    const err = await new Response(proc.stderr).text();
    results.push({ target, ok: false, sizeMB: 0, error: err.slice(0, 200) });
    console.log(`FAIL ${target}: ${err.slice(0, 100)}`);
  }
}

const okCount = results.filter(r => r.ok).length;
if (okCount < TARGETS.length) {
  console.log(`Built ${okCount}/${TARGETS.length} targets`);
  process.exit(1);
}
```

Flag `BUNLIGHT_TARGETS=linux-x64,darwin-arm64` pour build subset.

## CI matrix

`.github/workflows/release.yml` (si gh actions actifs) :
```yaml
name: release
on:
  push:
    tags: ["v*"]
jobs:
  build:
    strategy:
      matrix:
        target:
          - { runner: ubuntu-latest, name: linux-x64 }
          - { runner: ubuntu-latest, name: linux-arm64 }
          - { runner: macos-latest, name: darwin-x64 }
          - { runner: macos-latest, name: darwin-arm64 }
    runs-on: ${{ matrix.target.runner }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: BUNLIGHT_TARGETS=${{ matrix.target.name }} bun run scripts/build-standalone.ts
      - uses: actions/upload-artifact@v4
        with:
          name: bunlight-${{ matrix.target.name }}
          path: dist/standalone/bunlight-${{ matrix.target.name }}
  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v2
        with:
          files: bunlight-*/bunlight-*
```

## Verification

```bash
cd ~/bunmium/bunlight
bun run scripts/build-standalone.ts
ls -lh dist/standalone/  # 4 executables
./dist/standalone/bunlight-linux-x64 --version
```

## Done condition

- 4 executables produits par script
- CI workflow committé (si applicable)
- CHANGELOG 0.2.0 entry
- state.md §4
- status.json 06a → `completed`
