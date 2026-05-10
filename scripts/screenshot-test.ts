import { Browser } from "../src/api/browser.ts";
import { resolveLightpandaBin } from "../test/e2e/helpers.ts";

const lightpandaBin = await resolveLightpandaBin();
const p = await Browser.newPage({
	profile: "fast",
	spawnOpts: { logLevel: "error", readyTimeoutMs: 10_000, binaryPath: lightpandaBin ?? undefined },
});
try {
	await p.goto("https://design.google/", { timeoutMs: 25_000 });
	const png = await p.screenshot();
	console.log("PNG size:", png.byteLength, "bytes");
	await Bun.write("/tmp/dg-screenshot.png", png);
	console.log("Saved to /tmp/dg-screenshot.png");
	const sig = png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
	console.log("PNG signature:", sig ? "OK" : "INVALID");
} catch (e) {
	console.error("FAIL:", (e as Error).message);
} finally {
	await p.close();
	await Browser.close();
}
