#!/usr/bin/env bun
/**
 * `bunlight real-browser <action>` — Windows-first profile that attaches to
 * the user's installed Chrome and reuses their existing user data dir
 * (cookies, history, sessions, extensions, saved logins).
 *
 * Actions :
 *   launch    Spawn Chrome with --remote-debugging-port, attach via puppeteer,
 *             keep the window open and print the WS endpoint.
 *   inspect   Print the resolved chrome.exe path + user data dir + standard
 *             SQLite paths (Cookies, History, Login Data) without launching.
 *   profiles  List all sub-profiles (Default, Profile 1, Guest Profile, …)
 *             found inside the user data dir.
 *
 * The default profile path on yohan's box (used as the canonical example) :
 *   chrome.exe   : C:\Program Files\Google\Chrome\Application\chrome.exe
 *   userDataDir  : C:\Users\yohan\AppData\Local\Google\Chrome\User Data
 *
 * Exit codes : 0 OK, 2 misuse, 65 IO/runtime error, 70 software error.
 */

import {
	extractBookmarks,
	extractCookiesForDomainsViaCdp,
	extractCookiesViaCdp,
	extractHistoryFromSqlite,
	findChromeBinary,
	inspectChromeProfile,
	launchRealBrowser,
	resolveDefaultProfileDir,
	type RealBrowserOptions,
} from "../profiles/real-browser/index.ts";

interface CliOptions {
	action: "launch" | "inspect" | "profiles" | "cookies" | "history" | "bookmarks";
	executablePath?: string;
	userDataDir?: string;
	profileDirectory?: string;
	port?: number;
	headless: boolean;
	stealth: boolean;
	adblock: boolean;
	anonymizeUa: boolean;
	extraArgs: string[];
	json: boolean;
	keepAlive: boolean;
	domainFilters?: string[];
	historyLimit?: number;
}

function printUsage(): void {
	process.stdout.write(
		`bunlight real-browser — attach to the user's installed Chrome (Windows)

Usage:
  bunlight real-browser <action> [options]

Actions:
  launch     Spawn chrome.exe with --remote-debugging-port + your profile,
             then attach puppeteer-extra (stealth/adblock/anonymize-ua).
  inspect    Print resolved paths (chrome.exe, userDataDir, Cookies/History
             SQLite paths) without launching anything.
  profiles   List the sub-profiles (Default, Profile 1, ...) in userDataDir.
  cookies    Extract decrypted cookies via CDP (Chrome 127+ App-Bound
             Encryption supported). Optional positional args = domain filters.
  history    Read History SQLite (Chrome MUST be CLOSED). Optional positional
             arg = max entries (default 5000).
  bookmarks  Parse the Bookmarks JSON tree (safe while Chrome is running).

Options (launch):
  --executable-path <p>     Override chrome.exe path  (BUNLIGHT_CHROME_PATH)
  --user-data-dir <p>       Override user data dir    (BUNLIGHT_CHROME_PROFILE_DIR)
  --profile-directory <n>   Sub-profile name. Default: "Default"
  --port <N>                CDP port. Default: ephemeral
  --headless                Run --headless=new
  --no-stealth              Skip puppeteer-extra-plugin-stealth
  --adblock                 Add puppeteer-extra-plugin-adblocker (blockTrackers)
  --no-anonymize-ua         Skip puppeteer-extra-plugin-anonymize-ua
  --extra-arg <s>           Append a Chrome CLI flag (repeat for several)
  --keep-alive              Don't disconnect; print ws and wait for SIGINT
  --json                    JSON output

Examples:
  bunlight real-browser inspect
  bunlight real-browser profiles
  bunlight real-browser launch --keep-alive
  bunlight real-browser launch --profile-directory "Profile 1" --headless
  bunlight real-browser launch --json
  bunlight real-browser launch --executable-path "C:/Program Files/Google/Chrome/Application/chrome.exe"

Env vars:
  BUNLIGHT_CHROME_PATH          Override chrome.exe lookup
  BUNLIGHT_CHROME_PROFILE_DIR   Override Chrome User Data dir
  BUNLIGHT_REAL_BROWSER_ANYHOST  Allow on macOS/Linux (privacy implications)

Exit codes: 0 OK, 2 misuse, 65 IO/runtime, 70 software error
`,
	);
}

function parseArgs(argv: readonly string[]): CliOptions | null {
	const out: CliOptions = {
		action: "launch",
		headless: false,
		stealth: true,
		adblock: false,
		anonymizeUa: true,
		extraArgs: [],
		json: false,
		keepAlive: false,
	};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--executable-path":
				out.executablePath = argv[++i];
				break;
			case "--user-data-dir":
				out.userDataDir = argv[++i];
				break;
			case "--profile-directory":
				out.profileDirectory = argv[++i];
				break;
			case "--port":
				out.port = parseInt(argv[++i] ?? "0", 10);
				break;
			case "--headless":
				out.headless = true;
				break;
			case "--no-stealth":
				out.stealth = false;
				break;
			case "--adblock":
				out.adblock = true;
				break;
			case "--no-anonymize-ua":
				out.anonymizeUa = false;
				break;
			case "--extra-arg":
				out.extraArgs.push(argv[++i] ?? "");
				break;
			case "--keep-alive":
				out.keepAlive = true;
				break;
			case "--json":
				out.json = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}
	if (positional.length === 0) {
		out.action = "launch";
	} else {
		const action = positional[0];
		const valid = ["launch", "inspect", "profiles", "cookies", "history", "bookmarks"] as const;
		type Valid = (typeof valid)[number];
		if (!valid.includes(action as Valid)) {
			process.stderr.write(`Unknown action: ${action}\n`);
			return null;
		}
		out.action = action as Valid;
		if (out.action === "cookies") {
			out.domainFilters = positional.slice(1);
		} else if (out.action === "history") {
			const lim = parseInt(positional[1] ?? "5000", 10);
			if (Number.isFinite(lim) && lim > 0) out.historyLimit = lim;
		}
	}
	return out;
}

async function actionInspect(opts: CliOptions): Promise<void> {
	const exe = opts.executablePath ?? (await findChromeBinary());
	const userDataDir = opts.userDataDir ?? resolveDefaultProfileDir();
	const profile = inspectChromeProfile(userDataDir, opts.profileDirectory ?? "Default");

	const payload = {
		platform: process.platform,
		executablePath: exe,
		userDataDir,
		profileDirectory: profile.profileDirectory,
		cookieJarPath: profile.cookieJarPath,
		historyDbPath: profile.historyDbPath,
		loginDataDbPath: profile.loginDataDbPath,
		sessionsDir: profile.sessionsDir,
	};

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
		return;
	}

	process.stdout.write(`Platform        ${payload.platform}\n`);
	process.stdout.write(`Chrome binary   ${payload.executablePath ?? "(not found)"}\n`);
	process.stdout.write(`User data dir   ${payload.userDataDir}\n`);
	process.stdout.write(`Profile         ${payload.profileDirectory}\n`);
	process.stdout.write(`Cookies SQLite  ${payload.cookieJarPath}\n`);
	process.stdout.write(`History SQLite  ${payload.historyDbPath}\n`);
	process.stdout.write(`Login Data      ${payload.loginDataDbPath}\n`);
	process.stdout.write(`Sessions dir    ${payload.sessionsDir}\n`);
}

async function actionProfiles(opts: CliOptions): Promise<void> {
	const userDataDir = opts.userDataDir ?? resolveDefaultProfileDir();
	const localStatePath = `${userDataDir}/Local State`;

	const profiles: Array<{ id: string; name: string; userName?: string }> = [];
	const f = Bun.file(localStatePath);
	if (await f.exists()) {
		try {
			const json = JSON.parse(await f.text()) as {
				profile?: { info_cache?: Record<string, { name?: string; user_name?: string }> };
			};
			const info = json.profile?.info_cache ?? {};
			for (const [id, meta] of Object.entries(info)) {
				profiles.push({ id, name: meta.name ?? id, userName: meta.user_name });
			}
		} catch {
			/* fallthrough */
		}
	}

	if (profiles.length === 0) {
		// Fallback: scan directories matching "Default" / "Profile *".
		const glob = new Bun.Glob("{Default,Profile *,Guest Profile}");
		for await (const dir of glob.scan({ cwd: userDataDir, onlyFiles: false })) {
			profiles.push({ id: dir, name: dir });
		}
	}

	if (opts.json) {
		process.stdout.write(`${JSON.stringify({ userDataDir, profiles }, null, 2)}\n`);
		return;
	}

	process.stdout.write(`User data dir : ${userDataDir}\n`);
	if (profiles.length === 0) {
		process.stdout.write("(no profiles found)\n");
		return;
	}
	for (const p of profiles) {
		const userPart = p.userName ? `  <${p.userName}>` : "";
		process.stdout.write(`  ${p.id.padEnd(20)} ${p.name}${userPart}\n`);
	}
}

async function actionLaunch(opts: CliOptions): Promise<void> {
	const launchOpts: RealBrowserOptions = {
		executablePath: opts.executablePath,
		userDataDir: opts.userDataDir,
		profileDirectory: opts.profileDirectory,
		port: opts.port,
		headless: opts.headless,
		stealth: opts.stealth,
		adblock: opts.adblock,
		anonymizeUa: opts.anonymizeUa,
		extraArgs: opts.extraArgs,
	};

	const handle = await launchRealBrowser(launchOpts);

	const summary = {
		pid: handle.pid,
		wsEndpoint: handle.wsEndpoint,
		executablePath: handle.executablePath,
		userDataDir: handle.userDataDir,
	};

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	} else {
		process.stdout.write(`Chrome PID   : ${summary.pid}\n`);
		process.stdout.write(`CDP WS       : ${summary.wsEndpoint}\n`);
		process.stdout.write(`Binary       : ${summary.executablePath}\n`);
		process.stdout.write(`User data    : ${summary.userDataDir}\n`);
	}

	if (!opts.keepAlive) {
		await handle.close();
		return;
	}

	process.stdout.write("\nKeeping Chrome alive — Ctrl-C to detach.\n");
	const onSig = async (): Promise<void> => {
		await handle.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void onSig());
	process.on("SIGTERM", () => void onSig());
	// Block forever (Bun keeps the loop alive while listeners exist).
	await new Promise<void>(() => {});
}

async function actionCookies(opts: CliOptions): Promise<void> {
	const launchOpts: RealBrowserOptions = {
		executablePath: opts.executablePath,
		userDataDir: opts.userDataDir,
		profileDirectory: opts.profileDirectory,
		port: opts.port,
		headless: true,
		stealth: false,
		adblock: false,
		anonymizeUa: false,
		extraArgs: opts.extraArgs,
	};

	const handle = await launchRealBrowser(launchOpts);
	try {
		const filters = opts.domainFilters ?? [];
		const cookies =
			filters.length > 0
				? await extractCookiesForDomainsViaCdp(
						handle,
						filters.map((d) => (d.includes("://") ? d : `https://${d}`)),
					)
				: await extractCookiesViaCdp(handle);

		if (opts.json) {
			process.stdout.write(`${JSON.stringify(cookies, null, 2)}\n`);
		} else {
			process.stdout.write(`Got ${cookies.length} cookies\n`);
			for (const c of cookies as Array<{ name: string; domain: string; httpOnly: boolean }>) {
				process.stdout.write(
					`  ${c.domain.padEnd(40)} ${c.name}${c.httpOnly ? " (httpOnly)" : ""}\n`,
				);
			}
		}
	} finally {
		await handle.close();
	}
}

async function actionHistory(opts: CliOptions): Promise<void> {
	const limit = opts.historyLimit ?? 5000;
	const userDataDir = opts.userDataDir ?? resolveDefaultProfileDir();
	const profileDirectory = opts.profileDirectory ?? "Default";

	const entries = await extractHistoryFromSqlite(userDataDir, profileDirectory, limit);

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
		return;
	}

	const chromeTsToIso = (ts: number): string => {
		const ms = ts / 1000 - 11_644_473_600_000;
		return new Date(ms).toISOString();
	};

	process.stdout.write(`History entries: ${entries.length} (most recent first)\n\n`);
	for (const e of entries.slice(0, 50)) {
		const time = chromeTsToIso(e.last_visit_time);
		const title = (e.title || "").slice(0, 60).padEnd(60);
		process.stdout.write(`${time}  ${title}  ${e.url}\n`);
	}
	if (entries.length > 50) {
		process.stdout.write(`... (${entries.length - 50} more, use --json for full output)\n`);
	}
}

async function actionBookmarks(opts: CliOptions): Promise<void> {
	const userDataDir = opts.userDataDir ?? resolveDefaultProfileDir();
	const profileDirectory = opts.profileDirectory ?? "Default";
	const tree = await extractBookmarks(userDataDir, profileDirectory);

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(tree, null, 2)}\n`);
		return;
	}

	interface BkNode {
		type: "folder" | "url";
		name: string;
		url?: string;
		children?: BkNode[];
	}

	const walk = (node: BkNode, depth: number): void => {
		const indent = "  ".repeat(depth);
		if (node.type === "folder") {
			process.stdout.write(`${indent}[${node.name}]\n`);
			for (const c of node.children ?? []) walk(c as BkNode, depth + 1);
		} else {
			process.stdout.write(`${indent}* ${node.name}\n${indent}  ${node.url}\n`);
		}
	};
	walk(tree.bookmark_bar as BkNode, 0);
	walk(tree.other as BkNode, 0);
	if (tree.synced) walk(tree.synced as BkNode, 0);
}

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		printUsage();
		process.exit(2);
	}

	try {
		if (opts.action === "inspect") await actionInspect(opts);
		else if (opts.action === "profiles") await actionProfiles(opts);
		else if (opts.action === "cookies") await actionCookies(opts);
		else if (opts.action === "history") await actionHistory(opts);
		else if (opts.action === "bookmarks") await actionBookmarks(opts);
		else await actionLaunch(opts);
	} catch (err) {
		process.stderr.write(
			`bunlight real-browser: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		process.exit(65);
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err: unknown) => {
		process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}
