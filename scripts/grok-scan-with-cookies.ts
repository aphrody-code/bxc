/**
 * Run detect + recon on grok.com with ~/.bxc/cookies/grok.json (stealth browser).
 * Usage: cd ~/bxc && bun run scripts/grok-scan-with-cookies.ts
 */
import { deepDetect } from "../src/detect-deep.ts";
import { recon, type ReconCliOptions } from "../src/cli/recon.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const URL = "https://grok.com/";
const OUT =
	process.env.GROK_SCAN_OUT ?? "/home/ubuntu/aphrody/docs/x/reports/grok-com";

async function main(): Promise<void> {
	mkdirSync(OUT, { recursive: true });

	const detect = await deepDetect(URL);
	writeFileSync(join(OUT, "detect.json"), JSON.stringify(detect, null, 2));

	const reconOpts: ReconCliOptions = {
		url: URL,
		insecure: false,
		quiet: false,
		json: false,
		timeoutMs: 90_000,
		profile: "stealth",
		snapshotDir: OUT,
		screenshot: false,
		plain: false,
	};
	// Inject cookies via Browser inside recon — patch fetch path by using stealth only;
	// programmatic recon does not pass cookies yet; use Browser wrapper below.
	const { Browser } = await import("../src/api/browser.ts");
	const page = await Browser.newPage({
		profile: "stealth",
		cookies: "grok",
		spawnOpts: { logLevel: "error", readyTimeoutMs: 15_000 },
	});
	await page.goto(URL, { timeoutMs: 90_000 });
	const html = await page.content();
	const finalUrl = page.url();
	await page.close();
	writeFileSync(join(OUT, "browser-final-url.txt"), finalUrl);
	writeFileSync(join(OUT, "browser-html-head.txt"), html.slice(0, 8000));

	const reconResult = await recon(reconOpts);
	writeFileSync(join(OUT, "recon.json"), JSON.stringify(reconResult, null, 2));

	const md = [
		"# grok.com scan (bxc)",
		"",
		`- detect HTTP: ${detect.httpStatus}`,
		`- browser final: ${finalUrl}`,
		`- recon HTTP: ${reconResult.httpStatus}`,
		`- recon profile: ${reconResult.profile}`,
		`- CDN: ${reconResult.headers.cdnVendor}`,
		"",
		"Cookie jar: `~/.bxc/cookies/grok.json` (shortcut `grok`).",
		"",
	].join("\n");
	writeFileSync(join(OUT, "README.md"), md);
	console.log(md);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});