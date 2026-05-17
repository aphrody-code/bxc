import { readFileSync, writeFileSync } from "fs";

function fixFile(path: string, replacer: (content: string) => string) {
  try {
    const c = readFileSync(path, "utf8");
    const n = replacer(c);
    if (c !== n) writeFileSync(path, n);
  } catch (e) {}
}

fixFile("examples/ecommerce-price-monitor.ts", c => c.replace(/import type { Profile } from "[^"]+";\n/, ""));
fixFile("test/stealth-challenge.test.ts", c => c.replace("const resp = await page.goto", "await page.goto"));
fixFile("test/mocks/cloudflare-simulator.ts", c => c.replace(/const cookies = req\.headers\.get\("cookie"\) \?\? "";\n/, ""));
fixFile("test/profiles/auto-escalation.test.ts", c => c.replace("afterAll, beforeAll, ", ""));
fixFile("scripts/build-windows.ts", c => c.replace(/main\(\)\.catch\(\(err: unknown\) => \{\n\s+console\.error\("Fatal:", err instanceof Error \? err\.message : String\(err\)\);\n\s+process\.exit\(1\);\n\}\);/, "main();").replace(/async function buildStandalone\(distDir: string\) \{[\s\S]*?\}\n/, ""));
fixFile("src/google/serp-parser.ts", c => c.replace(", type ZigDoc, type ZigElement", ""));
fixFile("src/google/fetch.ts", c => c.replace("new Array(urls.length)", "Array.from({ length: urls.length })"));
fixFile("src/google/search.ts", c => c.replace(/import type { Page } from "\.\.\/api\/browser\.ts";\n/, "").replace("catch (e)", "catch (_e)"));
fixFile("test/cdp/domains/Input.test.ts", c => c.replace(/type InputMethod = [^;]+;\n/, ""));
fixFile("examples/crawl-chromium-developers.ts", c => c.replace("const client = await null", "const client = null"));
fixFile("src/serverless/routes/index.ts", c => c.replace("fetch(req: Request)", "fetch(_req: Request)"));
fixFile("test/integration/google-atlas.test.ts", c => c.replace("const { page, audit } = await", "const { page } = await").replace("const { page, audit } = await", "const { page } = await"));
fixFile("src/cli/serve.ts", c => c.replace(/import type \{ HttpProfileTransport \} from "\.\.\/transport\/HttpProfileTransport\.ts";\n/, "").replace(/import type \{ StaticDomTransport \} from "\.\.\/transport\/StaticDomTransport\.ts";\n/, ""));
fixFile("src/storage/KeyValueStore.ts", c => c.replace(/\(await Bun\.file\(row\.value_path\)\.exists\(\)\) &&\n\s*\(await Bun\.write\(row\.value_path, new Uint8Array\(0\)\)\);/, "if (await Bun.file(row.value_path).exists()) await Bun.write(row.value_path, new Uint8Array(0));"));
fixFile("test/cdp/domains/Page.test.ts", c => c.replace("beforeEach, ", ""));
fixFile("scripts/cleanup.ts", c => c.replace(/import \{ rm \} from "node:fs\/promises";\n/, "").replace("catch (e)", "catch (_e)"));
fixFile("src/router/framework-strategy.ts", c => c.replace(/detectGoogleSpecifics,\n\s*googleToTech,\n\s*/, ""));
fixFile("src/throttling/RateLimiter.ts", c => c.replace(/import \{ isGoogleDomain \} from "\.\.\/google\/dns\.ts";\n/, ""));
fixFile("scripts/god-mode-executor.ts", c => c.replace(/import \{ join \} from "path";\n/, ""));
fixFile("scripts/path-sentinel.ts", c => c.replace(/, isAbsolute, relative, dirname/, ""));
fixFile("src/google/verticals.ts", c => c.replace(/, type ZigElement/, ""));
fixFile("src/google/mass-scanner.ts", c => c.replace(/import \{ isGoogleDomain \} from "\.\/dns\.ts";\n/, "").replace("catch (e)", "catch (_e)"));
fixFile("src/mirror/mirror.ts", c => c.replace("new Array(items.length)", "Array.from({ length: items.length })"));
fixFile("test/e2e/challonge-crawl.e2e.test.ts", c => c.replace(/const patternNames = CHALLONGE_PATTERNS\.map\(\(p\) => p\.name\);\n/, ""));
fixFile("src/api/BrowserContext.ts", c => c.replace(/, HttpPage/, "").replace(/, PageOptions/, ""));
fixFile("test/cli/install.test.ts", c => c.replace("afterAll, beforeAll, ", ""));
fixFile("src/ai/extractor.ts", c => c.replace(/import \{ parseHtml \} from "\.\.\/ffi\/zigquery\.ts";\n/, ""));
fixFile("test/zigbridge-smoke.test.ts", c => c.replace("CString, ", ""));
fixFile("src/pool/PagePool.ts", c => c.replace("new Array(inputs.length)", "Array.from({ length: inputs.length })"));
fixFile("src/cli/install.ts", c => c.replace(/type ChromiumPlatformToken = [^;]+;\n/, ""));
fixFile("src/cli/har.ts", c => c.replace(/\.\.\.\(\(stats as object\) \?\? \{\}\)/, "...((stats as object) || {})"));
fixFile("src/api/browser.ts", c => c.replace("catch (err)", "catch (_err)"));
fixFile("src/ffi/curl-impersonate.ts", c => c.replace(/const CURL_HTTP_VERSION_NONE = 0;\nconst CURLINFO_RESPONSE_CODE = 0x200002;\nconst CURLINFO_EFFECTIVE_URL = 0x100001;\n/, ""));
fixFile("src/api/Locator.ts", c => c.replace("catch (err)", "catch (_err)"));
fixFile("src/utils/network-auditor.ts", c => c.replace("catch (e)", "catch (_e)"));
fixFile("src/recorder/HarReplayer.ts", c => c.replace(/const replayer = this;\n/, ""));
fixFile("src/stats/Statistics.ts", c => c.replace(/#windowDurationSum = 0;\n/, ""));

console.log("Done");
