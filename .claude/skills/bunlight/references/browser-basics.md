# Bunlight Browser API basics

Core `Browser` and `Page` API surface for `@bunmium/bunlight`. Load this reference when the user is starting fresh and needs the simplest possible scraper.

## The Browser class

`Browser` is a static singleton. There is no `new Browser()`; it manages the in-process Lightpanda engine for the lifetime of the Bun process.

```ts
import { Browser } from "@bunmium/bunlight";

// Open a new page, choose a profile.
const page = await Browser.newPage({ profile: "fast" });
```

### `Browser.newPage(opts)`

Returns a `Promise<Page>`. Options:

| Field | Type | Default | Description |
|---|---|---|---|
| `profile` | `"static" \| "fast" \| "http" \| "stealth" \| "max"` | `"fast"` | Transport choice. |
| `viewport` | `{ width, height }` | `{1920, 1080}` | CSS viewport. |
| `cookies` | `Cookie[]` | `[]` | Pre-injected cookie jar. |
| `userAgent` | `string` | profile default | Override UA. |
| `proxyUrl` | `string` | none | `http://user:pass@host:port`. |
| `timeoutMs` | `number` | `30000` | Default navigation timeout. |
| `blockResources` | `string[]` | `[]` | e.g. `["image","stylesheet","font"]`. |

### `Browser.transport()`

Returns the in-process `ConnectionTransport` for use with `puppeteer.connect()`. Lets you reuse Puppeteer's API surface against Bunlight's engine without spawning a subprocess.

## The Page class

A `Page` is a single document. Closing it releases the FFI resources. Always close in `finally`.

### Navigation

```ts
await page.goto(url, { waitUntil: "load", timeoutMs: 30000 });
const url = await page.url();
```

`waitUntil` accepts `"load"`, `"domcontentloaded"`, `"networkidle0"`, `"networkidle2"`.

### Inspection

```ts
const title = await page.title();
const html = await page.content();
```

### Selectors

```ts
const item = await page.$(".product");          // first match or null
const items = await page.$$(".product");         // all matches
const text = await item.$eval("h2", (el) => el.textContent);
```

### JavaScript evaluation

```ts
const count = await page.evaluate(() => document.querySelectorAll("li").length);
```

Available only on profiles with JS: `fast`, `stealth`, `max`. The `static` profile throws.

### Cookies

```ts
await page.setCookie({ name: "session", value: "...", domain: ".example.com", path: "/" });
const cookies = await page.cookies();
```

### Screenshots

```ts
await page.screenshot("out.png");
```

PNG only on Phase 2; JPEG/WebP arrive in Phase 3.

### Interaction

```ts
await page.type("input[name=email]", "user@example.com");
await page.click("button[type=submit]");
await page.waitForNavigation({ waitUntil: "load" });
```

### Cleanup

```ts
await page.close(); // always in `finally`
```

## Minimal scraper template

```ts
import { Browser } from "@bunmium/bunlight";

const url = "https://example.com";

const page = await Browser.newPage({ profile: "fast" });
try {
  await page.goto(url);
  const title = await page.title();
  await Bun.write("output.json", JSON.stringify({ url, title }));
} finally {
  await page.close();
}
```

## Lifecycle rules

1. One `Browser`, many `Page`s.
2. Always `await page.close()` (use `finally`).
3. Do not call `Browser.shutdown()` unless you know nothing else will create pages.
4. The Bun process exit will clean up all FFI resources, so explicit shutdown is rarely needed.

## Errors you will see

| Error | Cause | Fix |
|---|---|---|
| `Module not found: bun:browser` | Phase 3 not yet shipped | Use `@bunmium/bunlight` from npm |
| `lightpanda binary not found` | binary missing | install or set `$LIGHTPANDA_BIN` |
| `page.evaluate failed: no JS` | profile is `static` | switch to `fast` or higher |
| `page.goto timeout` | network hang or JS infinite | increase `timeoutMs`, try `domcontentloaded` |

## See also

- `references/profiles.md` for choosing a profile.
- `references/cookbook.md` for 10 worked recipes.
- `references/api.md` for the full method-by-method reference.
