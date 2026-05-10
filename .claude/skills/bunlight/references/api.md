---
description: Browser and Page API reference for Bunlight. Covers all methods, options, and types for creating pages, navigating, selecting elements, evaluating code, taking screenshots, managing cookies, and cleanup.
---

# Browser & Page API Reference

Complete reference for Bunlight's public `Browser` and `Page` classes.

## Browser API

Singleton instance for managing pages. In Phase 3, available as builtin `import { Browser } from "bun:browser"`. Until then, `import { Browser } from "@bunmium/bunlight"`.

### Methods

#### Browser.newPage(options?: PageOptions): Promise<Page>

Create a new page in the browser.

```ts
const page = await Browser.newPage({
  profile: "fast",              // "static", "fast", "http", "stealth", "max"
  viewport: { width: 1920, height: 1080 },
  userAgent: "Mozilla/5.0...",
  cookies: "./cookies.json",    // pre-load cookies
});
```

**PageOptions**:
```ts
interface PageOptions {
  mode?: "static" | "full";           // transport mode
  profile?: "static" | "fast" | "http" | "stealth" | "max";
  viewport?: { width: number; height: number };
  userAgent?: string;
  cookies?: string | Cookie[];         // path or array
  spawnOpts?: SocketPairTransportOptions;
  httpOpts?: ImpersonatedClientOptions;
  stealthOpts?: StealthOptions;
  maxOpts?: MaxOptions;
}
```

#### Browser.pages(): Page[]

Get all currently-open pages.

#### Browser.close(): Promise<void>

Close the browser and all pages.

#### Browser.transport(): ConnectionTransport

Get the underlying transport. Use with `puppeteer.connect()` for Puppeteer compatibility.

```ts
import puppeteer from "puppeteer-core";
import { Browser } from "@bunmium/bunlight";

const pBrowser = await puppeteer.connect({
  transport: Browser.transport()
});
```

## Page API

Represents a single browser page/tab.

### Navigation

#### page.goto(url: string, options?: NavigationOptions): Promise<Response>

Navigate to a URL and wait for the load event.

```ts
await page.goto("https://example.com", {
  waitUntil: "load",           // "load", "domcontentloaded", "networkidle"
  timeoutMs: 30000
});
```

#### page.url(): string

Get the current page URL.

#### page.title(): Promise<string>

Get the page title.

#### page.content(): Promise<string>

Get the full page HTML.

### Selectors & Elements

#### page.$(selector: string): Promise<ElementHandle | null>

Select a single element by CSS selector.

```ts
const heading = await page.$("h1");
if (heading) {
  const text = await heading.textContent();
}
```

#### page.$$(selector: string): Promise<ElementHandle[]>

Select all matching elements.

```ts
const items = await page.$$(".item");
console.log(items.length);
```

#### page.$eval(selector: string, fn: Function, ...args): Promise<any>

Evaluate a function on the first matching element (Lightpanda only, fails in static).

```ts
const text = await page.$eval("h1", el => el.textContent);
```

#### page.$$eval(selector: string, fn: Function, ...args): Promise<any[]>

Evaluate a function on all matching elements.

```ts
const titles = await page.$$eval("h1", els => els.map(el => el.textContent));
```

### Code Execution

#### page.evaluate(fn: Function | string, ...args): Promise<any>

Execute JavaScript in the page context (Lightpanda only).

```ts
const windowTitle = await page.evaluate(() => window.location.href);
const result = await page.evaluate(arg => arg * 2, 21);  // → 42
```

#### page.evaluateHandle(fn: Function, ...args): Promise<JSHandle>

Like `evaluate()` but returns a handle to the result.

### Screenshots & Rendering

#### page.screenshot(path: string, options?: ScreenshotOptions): Promise<Buffer>

Take a PNG screenshot and save to disk.

```ts
await page.screenshot("screenshot.png");
// or get buffer:
const buffer = await page.screenshot();
```

**ScreenshotOptions**:
```ts
interface ScreenshotOptions {
  fullPage?: boolean;       // full scroll height
  clip?: { x: number; y: number; width: number; height: number };
}
```

### Cookies & Storage

#### page.setCookie(...cookies: Cookie[]): Promise<void>

Set cookies before navigation.

```ts
await page.setCookie({
  name: "session",
  value: "abc123",
  domain: "example.com",
  path: "/",
  httpOnly: false,
  secure: true,
  sameSite: "Lax"
});
```

#### page.cookies(): Promise<Cookie[]>

Get all cookies for the page.

#### page.clearCookies(): Promise<void>

Clear all cookies.

**Cookie format**:
```ts
interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;  // Unix timestamp
}
```

### Waiting & Events

#### page.waitForSelector(selector: string, options?: WaitOptions): Promise<ElementHandle>

Wait for an element to appear.

```ts
await page.waitForSelector(".loaded", { timeoutMs: 5000 });
```

#### page.waitForNavigation(options?: WaitOptions): Promise<void>

Wait for a navigation event. Useful after clicking a link.

```ts
const clickPromise = page.click("a.next");
await page.waitForNavigation();
await clickPromise;
```

#### page.waitForFunction(fn: Function, options?: WaitOptions): Promise<any>

Wait for a condition to become true.

```ts
await page.waitForFunction(() => document.readyState === "complete");
```

### Interaction

#### page.click(selector: string): Promise<void>

Click an element.

```ts
await page.click("button.submit");
```

#### page.type(selector: string, text: string, options?: TypeOptions): Promise<void>

Type text into an input.

```ts
await page.type("input[name=search]", "hello world");
```

#### page.select(selector: string, values: string[]): Promise<string[]>

Select options in a dropdown.

```ts
await page.select("select", ["option1", "option2"]);
```

#### page.hover(selector: string): Promise<void>

Hover over an element.

```ts
await page.hover(".menu");
```

### Content Control

#### page.blockResources(types: ResourceType[]): Promise<void>

Block certain resource types to speed up loading.

```ts
await page.blockResources(["image", "stylesheet", "font"]);
```

**ResourceType**: `"Document"`, `"Stylesheet"`, `"Image"`, `"Media"`, `"Font"`, `"Script"`, `"XHR"`, `"Fetch"`, `"WebSocket"`, `"Manifest"`, `"Other"`

### Cleanup

#### page.close(): Promise<void>

Close the page and free resources.

```ts
await page.close();
```

#### page[Symbol.asyncDispose](): Promise<void>

Auto-close using `await using` syntax.

```ts
await using page = await Browser.newPage();
// page auto-closes on exit
```

## ElementHandle API

Low-level element reference.

#### handle.textContent(): Promise<string | null>

Get element text content.

#### handle.innerHTML(): Promise<string>

Get element HTML.

#### handle.getAttribute(name: string): Promise<string | null>

Get an attribute.

#### handle.click(): Promise<void>

Click the element.

#### handle.type(text: string): Promise<void>

Type into the element (for inputs).

#### handle.evaluate(fn: Function, ...args): Promise<any>

Evaluate a function on this element.

```ts
const isVisible = await handle.evaluate(el => el.offsetParent !== null);
```

## Notes

- **Static mode limitations**: `page.evaluate()`, `page.$eval()`, and code execution features are unavailable in `profile: "static"` (no JS engine). Switch to `profile: "fast"` for SPAs.
- **Async disposal**: Use `await using` syntax to auto-close pages:
  ```ts
  await using page = await Browser.newPage();
  // ...
  ```
- **Puppeteer compatibility**: All methods mirror Puppeteer v24+ API, so existing Puppeteer code works with Bunlight.

## See also

- `references/profiles.md` — which `Browser.newPage` profile to pick.
- `references/pool.md` — `PagePool`, `SessionPool`, `ProxyPool` API.
- `references/queue.md` — `RequestQueue` API and SQLite schema.
- `references/cookies.md` — `loadCookieJar` and cookie injection.
- `references/cookbook.md` — applied API examples (10 recipes).
