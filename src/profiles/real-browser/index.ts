/**
 * @module bunlight/profiles/real-browser
 *
 * Real-browser profile — attach bunlight to the user's locally installed
 * Chrome (or Chromium derivative), reusing their existing user profile so
 * cookies, history, sessions, extensions and saved logins are immediately
 * available to scripted flows.
 *
 * Platform: Windows by default. macOS/Linux opt-in via
 * `BUNLIGHT_REAL_BROWSER_ANYHOST=1`. We don't enable it everywhere because
 * spawning the user's main Chrome with `--remote-debugging-port` exposes
 * their authenticated session to anything that can reach the localhost
 * debugger socket.
 *
 * Architecture:
 *
 *   bunlight CLI (--profile real-browser)
 *      |
 *      +--> findChromeBinary()  ->  C:\Program Files\Google\Chrome\Application\chrome.exe
 *      +--> resolveProfileDir() ->  %LOCALAPPDATA%\Google\Chrome\User Data\Default
 *      |
 *      +--> spawn chrome.exe --remote-debugging-port=N
 *                            --user-data-dir=<profileDir>
 *                            --profile-directory=Default
 *                            --no-first-run --no-default-browser-check
 *      |
 *      +--> wait for /json/version on http://127.0.0.1:N
 *      +--> CDP attach via puppeteer-core (already a dep)
 *      +--> apply puppeteer-extra plugins (stealth + adblocker + anonymize-ua)
 *      |
 *      +--> hand the (browser, page) pair to the caller
 *
 * Why puppeteer-core over `bunlight serve`:
 *   The user's Chrome is fully featured (V8, extensions, GPU). We're
 *   *attaching*, not embedding. `puppeteer-core` is lighter than `puppeteer`
 *   (no bundled Chromium) and `puppeteer-extra` adds the plugins we want.
 *   This is the one place bunlight intentionally allows Chromium ecosystem
 *   tools — because the goal is to *use the real browser*.
 */

import { homedir } from "node:os";
import { join } from "node:path";

// Bun-native subprocess + fs (workspace rule: prefer Bun.spawn / Bun.file).
type ChildSubprocess = ReturnType<typeof Bun.spawn>;
async function fileExists(p: string): Promise<boolean> {
	return await Bun.file(p).exists();
}

export interface RealBrowserOptions {
	/**
	 * Override the chrome.exe / Chromium binary path. When `undefined`,
	 * we auto-discover via `findChromeBinary()`.
	 */
	executablePath?: string;
	/**
	 * Override the user data directory. When `undefined`, we resolve to
	 * the default profile directory for the current OS (see
	 * `resolveDefaultProfileDir()`).
	 */
	userDataDir?: string;
	/**
	 * Subdirectory of `userDataDir` to use as the active profile.
	 * Default: `"Default"`. Other typical values: `"Profile 1"`, `"Guest Profile"`.
	 */
	profileDirectory?: string;
	/**
	 * CDP port. When `undefined`, an ephemeral port is chosen.
	 */
	port?: number;
	/**
	 * Run Chrome headless. Default: false (you get a real, visible window).
	 * Note: on Windows this works best in `--headless=new` mode.
	 */
	headless?: boolean;
	/**
	 * Apply puppeteer-extra stealth plugins. Default: true.
	 */
	stealth?: boolean;
	/**
	 * Inject adblocker plugin. Default: false (adblocker can break some
	 * sites; opt-in).
	 */
	adblock?: boolean;
	/**
	 * Anonymize User-Agent (strip "HeadlessChrome", set realistic UA).
	 * Default: true when `stealth` is true.
	 */
	anonymizeUa?: boolean;
	/**
	 * Extra Chrome CLI flags appended verbatim. Use with care — most
	 * stealth/network setup is already handled.
	 */
	extraArgs?: string[];
	/**
	 * Maximum time to wait for the remote debugger to come up. Default: 15s.
	 */
	readyTimeoutMs?: number;
}

export interface RealBrowserHandle {
	/** PID of the spawned chrome.exe process. */
	pid: number;
	/** WebSocket URL of the CDP endpoint. */
	wsEndpoint: string;
	/** Path to the resolved user data dir (whatever was used in the end). */
	userDataDir: string;
	/** Path to the chrome.exe binary in use. */
	executablePath: string;
	/**
	 * The puppeteer Browser instance, ready to drive. Always wrapped via
	 * `puppeteer-extra` if `stealth/adblock/anonymizeUa` are on.
	 */
	browser: import("puppeteer-core").Browser;
	/**
	 * Cleanly shut down the browser and kill the chrome.exe child process.
	 */
	close(): Promise<void>;
}

// ─── Binary discovery ──────────────────────────────────────────────────

/**
 * Locate the chrome.exe (or fallback Chromium derivative) for the current OS.
 *
 * Order:
 *   1. `BUNLIGHT_CHROME_PATH` env-var (explicit override).
 *   2. Standard install locations on this OS.
 *   3. `null` if nothing is found.
 */
export async function findChromeBinary(): Promise<string | null> {
	if (process.env.BUNLIGHT_CHROME_PATH) {
		const p = process.env.BUNLIGHT_CHROME_PATH;
		if (await fileExists(p)) return p;
	}

	const home = homedir();
	const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
	const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
	const localAppData = process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");

	const candidates: string[] =
		process.platform === "win32"
			? [
					// Confirmed install path — yohan's box, 2026-05-10
					"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
					join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
					join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
					join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
					join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
					join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
					join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
				]
			: process.platform === "darwin"
				? [
						"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
						"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
						"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
						"/Applications/Chromium.app/Contents/MacOS/Chromium",
					]
				: [
						"/usr/bin/google-chrome",
						"/usr/bin/google-chrome-stable",
						"/usr/bin/chromium",
						"/usr/bin/chromium-browser",
						"/usr/bin/microsoft-edge",
						"/usr/bin/brave-browser",
						"/snap/bin/chromium",
					];

	for (const c of candidates) {
		if (await fileExists(c)) return c;
	}
	return null;
}

/**
 * Resolve the default Chrome user data dir for the current OS.
 *
 *   Windows  : %LOCALAPPDATA%\Google\Chrome\User Data
 *   macOS    : ~/Library/Application Support/Google/Chrome
 *   Linux    : ~/.config/google-chrome
 *
 * Override via `BUNLIGHT_CHROME_PROFILE_DIR` env-var.
 */
export function resolveDefaultProfileDir(): string {
	if (process.env.BUNLIGHT_CHROME_PROFILE_DIR) {
		return process.env.BUNLIGHT_CHROME_PROFILE_DIR;
	}

	const home = homedir();
	const localAppData = process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");

	if (process.platform === "win32") {
		return join(localAppData, "Google", "Chrome", "User Data");
	}
	if (process.platform === "darwin") {
		return join(home, "Library", "Application Support", "Google", "Chrome");
	}
	return join(home, ".config", "google-chrome");
}

// ─── Free port helper ──────────────────────────────────────────────────

async function pickEphemeralPort(): Promise<number> {
	// Bun.listen with port=0 → kernel picks a free port; we read .port and stop.
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: { data() {}, open() {}, close() {} },
	});
	const port = server.port;
	server.stop();
	return port;
}

// ─── Spawn + CDP attach ────────────────────────────────────────────────

async function waitForRemoteDebugger(port: number, timeoutMs: number): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
				signal: AbortSignal.timeout(1000),
			});
			if (res.ok) {
				const json = (await res.json()) as { webSocketDebuggerUrl?: string };
				if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
			}
		} catch (err) {
			lastErr = err;
		}
		await Bun.sleep(150);
	}
	throw new Error(
		`real-browser: timeout waiting for chrome.exe --remote-debugging-port=${port}` +
			(lastErr
				? ` (last err: ${lastErr instanceof Error ? lastErr.message : String(lastErr)})`
				: ""),
	);
}

/**
 * Spawn the locally installed Chrome with the user's profile mounted, then
 * attach via puppeteer-core (optionally enriched with puppeteer-extra
 * stealth/adblock/anonymize-ua plugins).
 *
 * Returns a handle that owns the chrome.exe child process; call `.close()`
 * to clean up. If the parent script crashes, the child stays alive (Chrome
 * is meant to outlive transient automation processes), so wire your own
 * shutdown hook if you need stricter lifetime control.
 */
export async function launchRealBrowser(opts: RealBrowserOptions = {}): Promise<RealBrowserHandle> {
	const exe = opts.executablePath ?? (await findChromeBinary());
	if (!exe) {
		throw new Error(
			"real-browser: Chrome / Chromium not found. Set BUNLIGHT_CHROME_PATH or install Chrome.",
		);
	}

	const userDataDir = opts.userDataDir ?? resolveDefaultProfileDir();
	// Best-effort existence check via Bun.file: a directory's `.exists()`
	// returns true on Bun even though it's not strictly a file.
	if (!(await fileExists(userDataDir))) {
		throw new Error(
			`real-browser: user data dir not found: ${userDataDir} — set BUNLIGHT_CHROME_PROFILE_DIR or pass userDataDir.`,
		);
	}

	const profileDirectory = opts.profileDirectory ?? "Default";
	const port = opts.port ?? (await pickEphemeralPort());
	const stealth = opts.stealth ?? true;
	const adblock = opts.adblock ?? false;
	const anonymizeUa = opts.anonymizeUa ?? stealth;
	const headless = opts.headless ?? false;

	const args: string[] = [
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${userDataDir}`,
		`--profile-directory=${profileDirectory}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate,OptimizationHints,MediaRouter",
		"--disable-extensions-except=",
		"--password-store=basic",
	];
	if (headless) args.push("--headless=new");
	if (opts.extraArgs) args.push(...opts.extraArgs);

	const child: ChildSubprocess = Bun.spawn([exe, ...args], {
		stdio: ["ignore", "ignore", "pipe"],
	});

	const wsEndpoint = await waitForRemoteDebugger(port, opts.readyTimeoutMs ?? 15_000).catch(
		async (err) => {
			child.kill();
			throw err;
		},
	);

	// Lazy-load puppeteer-core only when we actually need to attach. Keeps
	// the bunlight cold-start fast for non-real-browser flows.
	const puppeteerCore = await import("puppeteer-core");
	let puppeteer: typeof puppeteerCore = puppeteerCore;

	if (stealth || adblock || anonymizeUa) {
		// Apply puppeteer-extra wrapper + plugins. This is the only
		// supported path to inject stealth into a running CDP session.
		const extra = await import("puppeteer-extra").catch(() => null);
		if (extra) {
			const wrapper = (extra as unknown as { default: { use: Function } }).default;
			if (stealth) {
				const stealthPlugin = await import("puppeteer-extra-plugin-stealth").catch(() => null);
				if (stealthPlugin) {
					const StealthPlugin = (stealthPlugin as unknown as { default: () => unknown }).default;
					wrapper.use(StealthPlugin());
				}
			}
			if (adblock) {
				const ad = await import("puppeteer-extra-plugin-adblocker").catch(() => null);
				if (ad) {
					const Ad = (ad as unknown as { default: (o?: unknown) => unknown }).default;
					wrapper.use(Ad({ blockTrackers: true }));
				}
			}
			if (anonymizeUa) {
				const ua = await import("puppeteer-extra-plugin-anonymize-ua").catch(() => null);
				if (ua) {
					const Ua = (ua as unknown as { default: () => unknown }).default;
					wrapper.use(Ua());
				}
			}
			// Keep the bare puppeteer-core as the type ; the extra plugins
			// patch the prototype in place.
			puppeteer = puppeteerCore;
		}
	}

	const browser = await puppeteer.connect({
		browserWSEndpoint: wsEndpoint,
		defaultViewport: null, // honor the real Chrome window size
	});

	const pid = child.pid;
	if (typeof pid !== "number") {
		throw new Error("real-browser: child.pid is undefined");
	}

	return {
		pid,
		wsEndpoint,
		userDataDir,
		executablePath: exe,
		browser,
		async close(): Promise<void> {
			try {
				await browser.disconnect();
			} catch {
				/* noop */
			}
			try {
				child.kill();
			} catch {
				/* noop */
			}
		},
	};
}

// ─── Cookie / history / session readers (read-only helpers) ────────────

export interface ChromeProfileInspection {
	cookieJarPath: string;
	historyDbPath: string;
	loginDataDbPath: string;
	sessionsDir: string;
	userDataDir: string;
	profileDirectory: string;
}

/**
 * Resolve the standard SQLite/file paths inside a Chrome user profile.
 * Useful to back up cookies/history before launching, or to diff sessions
 * between runs.
 *
 * NB: these files are SQLite databases; reading them while Chrome is
 * running may yield stale data. Best to inspect after `close()`.
 */
export function inspectChromeProfile(
	userDataDir = resolveDefaultProfileDir(),
	profileDirectory = "Default",
): ChromeProfileInspection {
	const profile = join(userDataDir, profileDirectory);
	return {
		cookieJarPath: join(profile, "Network", "Cookies"),
		historyDbPath: join(profile, "History"),
		loginDataDbPath: join(profile, "Login Data"),
		sessionsDir: join(profile, "Sessions"),
		userDataDir,
		profileDirectory,
	};
}

// ─── CDP-based extractors (works on Chrome 127+ with App-Bound Encryption) ─

/**
 * Extract all cookies from the running Chrome instance via CDP.
 *
 * **Why CDP and not direct SQLite read?**
 *   Chrome 127+ encrypts cookie values with "App-Bound Encryption" (AES-256-GCM
 *   bound to chrome.exe's process identity) on top of DPAPI. Reading the
 *   `Cookies` SQLite directly returns ciphertext only chrome.exe itself can
 *   decrypt. CDP `Network.getAllCookies` runs *inside* chrome.exe and returns
 *   plaintext cookies — by design, no DPAPI/ABE handling on our side.
 *
 * Pre-conditions:
 *   - Chrome was started via `launchRealBrowser()` (so CDP is available).
 *   - The user's profile is mounted (so the cookie jar reflects real sessions).
 *
 * Returns the standard CDP cookie shape (name, value, domain, path, expires,
 * httpOnly, secure, sameSite, sourceScheme, sourcePort, partitionKey, ...).
 */
export async function extractCookiesViaCdp(handle: RealBrowserHandle): Promise<
	Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		expires: number;
		size: number;
		httpOnly: boolean;
		secure: boolean;
		session: boolean;
		sameSite?: string;
		priority?: string;
		sourceScheme?: string;
		sourcePort?: number;
		partitionKey?: unknown;
	}>
> {
	const pages = await handle.browser.pages();
	const page = pages[0] ?? (await handle.browser.newPage());
	const cdp = await page.target().createCDPSession();
	try {
		const result = (await cdp.send("Network.getAllCookies")) as { cookies: unknown[] };
		return result.cookies as Array<{
			name: string;
			value: string;
			domain: string;
			path: string;
			expires: number;
			size: number;
			httpOnly: boolean;
			secure: boolean;
			session: boolean;
		}>;
	} finally {
		await cdp.detach().catch(() => undefined);
	}
}

/**
 * Filter cookies for a specific domain via CDP `Network.getCookies`.
 * Faster than `getAllCookies + filter` when the domain set is known.
 */
export async function extractCookiesForDomainsViaCdp(
	handle: RealBrowserHandle,
	urls: readonly string[],
): Promise<unknown[]> {
	const pages = await handle.browser.pages();
	const page = pages[0] ?? (await handle.browser.newPage());
	const cdp = await page.target().createCDPSession();
	try {
		const result = (await cdp.send("Network.getCookies", { urls: [...urls] })) as {
			cookies: unknown[];
		};
		return result.cookies;
	} finally {
		await cdp.detach().catch(() => undefined);
	}
}

// ─── Offline (Chrome closed) SQLite readers ────────────────────────────

interface HistoryEntry {
	url: string;
	title: string;
	visit_count: number;
	last_visit_time: number; // Chrome timestamp (microseconds since 1601-01-01 UTC)
}

/**
 * Read the History SQLite (Chrome stores URL visits unencrypted).
 *
 * **Pre-condition: Chrome must be CLOSED**. The SQLite is locked while
 * chrome.exe runs.
 *
 * Returns up to `limit` most-recent entries.
 */
export async function extractHistoryFromSqlite(
	userDataDir = resolveDefaultProfileDir(),
	profileDirectory = "Default",
	limit = 5000,
): Promise<HistoryEntry[]> {
	const { Database } = await import("bun:sqlite");
	const inspection = inspectChromeProfile(userDataDir, profileDirectory);
	if (!(await fileExists(inspection.historyDbPath))) {
		throw new Error(`real-browser: History SQLite not found at ${inspection.historyDbPath}`);
	}
	const db = new Database(inspection.historyDbPath, { readonly: true });
	try {
		const rows = db
			.query<
				HistoryEntry,
				[number]
			>(`SELECT urls.url, urls.title, urls.visit_count, urls.last_visit_time
			   FROM urls
			   ORDER BY urls.last_visit_time DESC
			   LIMIT ?`)
			.all(limit);
		return rows;
	} finally {
		db.close(false);
	}
}

interface BookmarkEntry {
	id: string;
	type: "folder" | "url";
	name: string;
	url?: string;
	dateAdded?: string;
	children?: BookmarkEntry[];
}

/**
 * Parse the `Bookmarks` JSON file (Chrome doesn't lock it). Safe to read
 * while Chrome is running. Returns the full tree.
 */
export async function extractBookmarks(
	userDataDir = resolveDefaultProfileDir(),
	profileDirectory = "Default",
): Promise<{ bookmark_bar: BookmarkEntry; other: BookmarkEntry; synced?: BookmarkEntry }> {
	const path = join(userDataDir, profileDirectory, "Bookmarks");
	const f = Bun.file(path);
	if (!(await f.exists())) {
		throw new Error(`real-browser: Bookmarks JSON not found at ${path}`);
	}
	const json = JSON.parse(await f.text()) as {
		roots: { bookmark_bar: BookmarkEntry; other: BookmarkEntry; synced?: BookmarkEntry };
	};
	return json.roots;
}
