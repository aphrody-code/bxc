/**
 * 05-puppeteer-zero-spawn.ts
 *
 * Demonstrates connecting puppeteer-core to Bunlight without spawning any
 * external process.  Two modes are shown:
 *
 *   1. Static mode  — 100% in-process, no binary, DOM-only via StaticDomTransport
 *   2. Full mode    — sub-process Lightpanda via SocketPairTransport (requires
 *                     `lightpanda` on $PATH)
 *
 * Run:
 *   bun examples/05-puppeteer-zero-spawn.ts
 *   bun examples/05-puppeteer-zero-spawn.ts --full   # full mode
 */

import puppeteer from "puppeteer-core";
import { StaticDomTransport } from "../src/transport/StaticDomTransport.js";
import { Browser } from "../src/api/browser.js";

const useFullMode = process.argv.includes("--full");

// ---------------------------------------------------------------------------
// Helper — print a coloured section header
// ---------------------------------------------------------------------------

function section(title: string): void {
	console.log(`\n${"─".repeat(60)}`);
	console.log(`  ${title}`);
	console.log("─".repeat(60));
}

// ---------------------------------------------------------------------------
// Mode 1 — Static in-process transport
// ---------------------------------------------------------------------------

async function runStaticMode(): Promise<void> {
	section("Mode 1: StaticDomTransport (zero spawn, zero TCP)");

	// Create the transport directly and hand it to puppeteer.connect()
	const transport = StaticDomTransport.create();

	// puppeteer.connect() accepts any ConnectionTransport-compatible object
	const browser = await puppeteer.connect({ transport });

	console.log("puppeteer.connect() succeeded — browser version:", browser.version());

	const page = await browser.newPage();

	// Navigate via data: URI — works completely in-process
	await page.goto(
		"data:text/html," +
			encodeURIComponent(`
    <!DOCTYPE html>
    <html>
      <head><title>Hello Bunlight</title></head>
      <body>
        <h1 id="heading">Hello from StaticDomTransport</h1>
        <ul>
          <li class="item">Alpha</li>
          <li class="item">Beta</li>
          <li class="item">Gamma</li>
        </ul>
        <p id="desc">No spawn. No TCP. Just Bun.</p>
      </body>
    </html>
  `),
	);

	const title = await page.title();
	console.log("page.title() →", title);

	const content = await page.content();
	console.log("page.content() length →", content.length, "chars");

	// Demonstrate that puppeteer-core's high-level API works with our transport
	// via Runtime.evaluate (StaticDomTransport pattern-matches known expressions)
	const titleEval = await page.evaluate(() => document.title);
	console.log("page.evaluate(document.title) →", titleEval);

	// Use $eval for element text extraction (goes through callFunctionOn)
	try {
		const h1Text = await page.$eval("h1", (el) => el.textContent?.trim());
		console.log("$eval h1 textContent →", h1Text);
	} catch {
		console.log("$eval not supported in static mode (no JS engine)");
	}

	await browser.disconnect();
	transport.close();

	console.log("\nStatic mode complete. No process was spawned.");
}

// ---------------------------------------------------------------------------
// Mode 2 — SocketPairTransport (Lightpanda sub-process, no TCP port)
// ---------------------------------------------------------------------------

async function runFullMode(): Promise<void> {
	section("Mode 2: SocketPairTransport (Lightpanda sub-process via stdin/stdout)");

	// Dynamically import so we don't load Bun.spawn-dependent code in static-only builds
	const { SocketPairTransport } = await import("../src/transport/SocketPairTransport.js");

	console.log("Spawning lightpanda...");
	let transport: InstanceType<typeof SocketPairTransport>;

	try {
		transport = await SocketPairTransport.create({
			binaryPath: process.env["LIGHTPANDA_BIN"] ?? "lightpanda",
			readyTimeoutMs: 8000,
		});
	} catch (err) {
		console.error("Failed to spawn lightpanda:", err instanceof Error ? err.message : err);
		console.error("Install lightpanda and add it to $PATH, or set LIGHTPANDA_BIN=<path>.");
		process.exit(1);
	}

	console.log("lightpanda pid:", transport.pid);

	const browser = await puppeteer.connect({ transport });
	console.log("puppeteer.connect() succeeded");

	const page = await browser.newPage();
	await page.goto("https://example.com", { waitUntil: "domcontentloaded" });

	const title = await page.title();
	console.log("page.title() →", title);

	const content = await page.content();
	console.log("page.content() length →", content.length, "chars");

	await browser.disconnect();
	await transport.closeProcess();

	console.log("\nFull mode complete. Lightpanda sub-process terminated.");
}

// ---------------------------------------------------------------------------
// Mode 3 — Browser singleton convenience API (static, no puppeteer-core needed)
// ---------------------------------------------------------------------------

async function runBrowserSingletonDemo(): Promise<void> {
	section("Mode 3: Browser singleton (built-in Bunlight API)");

	const page = await Browser.newPage();
	await page.goto(
		"data:text/html," +
			encodeURIComponent(`
    <html>
      <head><title>Singleton Demo</title></head>
      <body>
        <p class="msg">Browser singleton works!</p>
      </body>
    </html>
  `),
	);

	console.log("title →", await page.title());
	console.log("url →", page.url());
	console.log("content length →", (await page.content()).length);

	const els = await page.$$(".msg");
	console.log("  .msg elements found:", els.length);

	// await using syntax — auto-closes on exit
	await page[Symbol.asyncDispose]();

	console.log("open pages after dispose:", Browser.pages().length);
	await Browser.close();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

try {
	await runStaticMode();
	await runBrowserSingletonDemo();

	if (useFullMode) {
		await runFullMode();
	} else {
		console.log("\nSkipping full mode (SocketPairTransport). Pass --full to enable.");
	}

	console.log("\nAll demos completed successfully.");
} catch (err) {
	console.error("Demo failed:", err);
	process.exit(1);
}
