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
	findChromeBinary,
	inspectChromeProfile,
	launchRealBrowser,
	resolveDefaultProfileDir,
	type RealBrowserOptions,
} from "../profiles/real-browser/index.ts";

interface CliOptions {
	action: "launch" | "inspect" | "profiles";
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
		if (action !== "launch" && action !== "inspect" && action !== "profiles") {
			process.stderr.write(`Unknown action: ${action}\n`);
			return null;
		}
		out.action = action;
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

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		printUsage();
		process.exit(2);
	}

	try {
		if (opts.action === "inspect") await actionInspect(opts);
		else if (opts.action === "profiles") await actionProfiles(opts);
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
