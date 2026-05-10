# 04b — Agent `perf-memory`

**Phase** : 2
**Subagent type** : `performance-engineer`
**Durée estimée** : 1.5h

## Mission

Réduire le RSS daemon idle à <30 MB (vs 67-76 MB actuels).

## Read-first

1. `~/bunmium/CLAUDE.md`, `bunlight/CLAUDE.md`, `00-context.md`
2. `bunlight/src/cli/serve.ts`
3. `bunlight/src/transport/{StaticDomTransport,SocketPairTransport,InProcessTransport}.ts`
4. `bunlight/src/ffi/{zigquery,curl-impersonate}.ts`
5. `bunlight/package.json` (dependencies)

## Scope strict

**Touche** :
- `bunlight/src/cli/serve.ts` (audit imports)
- `bunlight/src/transport/*.ts` (weak refs sur ZigDoc, dispose après navigation)
- `bunlight/src/profiles/index.ts`
- `bunlight/scripts/measure-rss.ts` (à créer)

**NE TOUCHE PAS** : tests, FFI lib, scripts non-mesure.

## Approches

### 1. Audit des imports

Lister tous les top-level imports de `src/cli/serve.ts` et identifier ceux qui chargent des deps lourdes mais inutiles en runtime.

```bash
cd ~/bunmium/bunlight
grep -E "^import" src/cli/serve.ts
```

Pour chaque import : peut-il être lazy ? Si oui, déplacer en `await import(...)` au point d'usage.

Suspects probables :
- `src/recorder/HarRecorder.ts` (peut-être chargé même si HAR pas activé)
- `src/profiles/{stealth,max}/index.ts` (déjà géré par 04a)
- `src/router/framework-strategy.ts` (peut-être chargé sans détection)

### 2. Weak refs sur ZigDoc

Dans `StaticDomTransport.ts`, chaque `Page.navigate` crée un `ZigDoc` (parsed HTML) qui survit jusqu'à `Target.closeTarget`. Si une session est inactive longtemps, le ZigDoc reste en mémoire.

```ts
// AVANT
class PageState {
  zigDoc: ZigDoc;
}

// APRÈS
class PageState {
  #zigDocRef: WeakRef<ZigDoc> | null = null;
  #zigDocFinalizer = new FinalizationRegistry((handle: number) => {
    bl_doc_destroy(handle); // free Zig memory
  });

  setZigDoc(doc: ZigDoc) {
    this.#zigDocRef = new WeakRef(doc);
    this.#zigDocFinalizer.register(doc, doc.handle);
  }

  getZigDoc(): ZigDoc | null {
    return this.#zigDocRef?.deref() ?? null;
  }
}
```

Attention : si `getZigDoc()` retourne null après GC, il faut re-fetch le HTML et re-parse. Garder le `rawHtml` (string) qui est plus léger.

### 3. GC explicite après navigation

Après `Page.navigate` complet (loadEventFired emit), si profile=static n'attend plus rien :
```ts
if (typeof Bun !== "undefined" && Bun.gc) {
  Bun.gc(false); // false = soft GC
}
```

### 4. Mesure

`scripts/measure-rss.ts` :
```ts
import { spawn } from "bun";

for (const profile of ["static", "fast"]) {
  const proc = spawn({
    cmd: ["bun", "run", "src/cli/serve.ts", "serve", "--cdp-port", "0", "--profile", profile],
    stdout: "pipe",
  });
  await readPortFromStdout(proc);
  // Wait 2 seconds for steady state
  await new Promise(r => setTimeout(r, 2000));
  // Read /proc/<pid>/status
  const status = await Bun.file(`/proc/${proc.pid}/status`).text();
  const rss = parseInt(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? "0");
  console.log(`profile=${profile}: RSS=${(rss / 1024).toFixed(1)} MB`);
  proc.kill();
  await proc.exited;
}
```

Critère pass : RSS idle <30 MB pour static, <50 MB pour fast (Lightpanda subprocess inclus).

## Done condition

- `bun run scripts/measure-rss.ts` montre RSS<30/50
- Diff montrant les imports rendus lazy
- 0 regression
- state.md §4
- status.json 04b → `completed`
