/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { join, resolve, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

function printUsage(): void {
	Bun.stdout.write(
		`bxc actor — Bxc Actor lifecycle and runner emulation

Usage:
  bxc actor <command> [options]

Commands:
  run <file_path>  Run a local script file as an Actor
  init <name>      Scaffold a basic Bxc-powered Actor project directory

Options:
  --input <json>     Provide input JSON directly via CLI (for 'run')
  --storage-dir <d>  Custom storage directory (default: './storage')
  --purge            Purge storage on start (default: true)
  --help, -h         Print this help

Examples:
  bxc actor run src/main.ts --input '{"url":"https://example.com"}'
  bxc actor init my-crawler
`,
	);
}

export async function main(
	argv: string[],
	baseOpts: CommonOptions,
	cliOptions?: { exitProcess?: boolean },
): Promise<void> {
	const exitProcess =
		cliOptions?.exitProcess ?? process.env.NODE_ENV !== "test";

	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printUsage();
		return;
	}

	const command = argv[0];
	const commandArgs = argv.slice(1);

	if (command === "run") {
		await handleRun(commandArgs, baseOpts, exitProcess);
	} else if (command === "init") {
		await handleInit(commandArgs, baseOpts, exitProcess);
	} else {
		logger.error(`Unknown actor command: ${command}`);
		printUsage();
		if (exitProcess) {
			process.exit(EXIT.MISUSE);
		} else {
			throw new Error(`Unknown actor command: ${command}`);
		}
	}
}

async function handleRun(
	args: string[],
	baseOpts: CommonOptions,
	exitProcess: boolean,
): Promise<void> {
	let filePath = "";
	let inputStr = "";
	let storageDir = "";
	let purge = true;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--input") {
			inputStr = args[++i];
		} else if (arg === "--storage-dir") {
			storageDir = args[++i];
		} else if (arg === "--purge") {
			purge = true;
		} else if (arg === "--no-purge") {
			purge = false;
		} else if (arg.startsWith("-")) {
			logger.error(`Unknown option: ${arg}`);
			if (exitProcess) process.exit(EXIT.MISUSE);
			throw new Error(`Unknown option: ${arg}`);
		} else {
			filePath = arg;
		}
	}

	if (!filePath) {
		logger.error("Script file path, directory, or Git URL is required");
		if (exitProcess) process.exit(EXIT.MISUSE);
		throw new Error("Script file path, directory, or Git URL is required");
	}

	const resolvedStorageDir = resolve(
		storageDir ||
			process.env.BXC_STORAGE_DIR ||
			process.env.APIFY_LOCAL_STORAGE_DIR ||
			"./storage",
	);

	const isGitUrl =
		filePath.startsWith("git+") ||
		filePath.startsWith("git@") ||
		filePath.includes("github.com/") ||
		filePath.includes("gitlab.com/");

	let runDir = process.cwd();
	let runCommandArgs: string[] = [];

	if (isGitUrl) {
		logger.log(`Detected Git URL: ${filePath}`);
		const repoName = filePath.split("/").pop()?.replace(".git", "") || "actor-git";
		const tempDir = join(resolvedStorageDir, "temp-actors", repoName);
		if (!existsSync(tempDir)) {
			mkdirSync(tempDir, { recursive: true });
		}
		logger.log(`Cloning repository into: ${tempDir}`);
		const cloneProc = Bun.spawn(["git", "clone", filePath.replace(/^git\+/, ""), tempDir], {
			stdout: "inherit",
			stderr: "inherit",
		});
		const cloneCode = await cloneProc.exited;
		if (cloneCode !== 0) {
			logger.error("Failed to clone Git repository");
			if (exitProcess) process.exit(EXIT.SOFTWARE);
			throw new Error("Failed to clone Git repository");
		}
		filePath = tempDir;
	}

	const resolvedPath = resolve(filePath);
	let isDirectory = false;
	if (existsSync(resolvedPath)) {
		const stat = statSync(resolvedPath);
		isDirectory = stat.isDirectory();
	} else {
		logger.error(`File or directory not found: ${resolvedPath}`);
		if (exitProcess) process.exit(EXIT.MISUSE);
		throw new Error(`File or directory not found: ${resolvedPath}`);
	}

	if (isDirectory) {
		runDir = resolvedPath;
		const actorJsonPath = join(resolvedPath, "actor.json");
		const apifyJsonPath = join(resolvedPath, "apify.json");
		const pkgJsonPath = join(resolvedPath, "package.json");

		let actorConfig: any = {};
		if (existsSync(actorJsonPath)) {
			try {
				actorConfig = JSON.parse(readFileSync(actorJsonPath, "utf8"));
			} catch {}
		} else if (existsSync(apifyJsonPath)) {
			try {
				actorConfig = JSON.parse(readFileSync(apifyJsonPath, "utf8"));
			} catch {}
		}

		if (actorConfig.run) {
			runCommandArgs = actorConfig.run.split(" ");
		} else if (actorConfig.start) {
			runCommandArgs = actorConfig.start.split(" ");
		} else if (existsSync(pkgJsonPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
				if (pkg.scripts && pkg.scripts.start) {
					runCommandArgs = ["bun", "run", "start"];
				} else if (pkg.main) {
					runCommandArgs = ["bun", "run", pkg.main];
				} else {
					runCommandArgs = ["bun", "run", "src/main.ts"];
				}
			} catch {
				runCommandArgs = ["bun", "run", "src/main.ts"];
			}
		} else {
			runCommandArgs = ["bun", "run", "src/main.ts"];
		}
	} else {
		runDir = dirname(resolvedPath);
		runCommandArgs = ["bun", "run", resolvedPath];
	}

	if (inputStr) {
		const kvsDefaultDir = join(
			resolvedStorageDir,
			"key_value_stores",
			"default",
		);
		if (!existsSync(kvsDefaultDir)) {
			mkdirSync(kvsDefaultDir, { recursive: true });
		}
		writeFileSync(join(kvsDefaultDir, "INPUT.json"), inputStr, "utf8");
	}

	const spawnEnv: Record<string, string> = {
		...process.env,
		BXC_STORAGE_DIR: resolvedStorageDir,
		APIFY_LOCAL_STORAGE_DIR: resolvedStorageDir,
		APIFY_PURGE_ON_START: purge ? "1" : "0",
	};

	logger.log(`Running actor inside: ${runDir} with command: ${runCommandArgs.join(" ")}`);
	const proc = Bun.spawn(runCommandArgs, {
		cwd: runDir,
		env: spawnEnv,
		stdout: "inherit",
		stderr: "inherit",
	});

	const code = await proc.exited;
	if (code !== 0) {
		logger.error(`Actor process exited with code ${code}`);
	}
	if (exitProcess) {
		process.exit(code);
	}
}

async function handleInit(
	args: string[],
	baseOpts: CommonOptions,
	exitProcess: boolean,
): Promise<void> {
	let name = "";
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("-")) {
			logger.error(`Unknown option: ${arg}`);
			if (exitProcess) process.exit(EXIT.MISUSE);
			throw new Error(`Unknown option: ${arg}`);
		} else {
			name = arg;
		}
	}

	if (!name) {
		logger.error("Project name is required");
		if (exitProcess) process.exit(EXIT.MISUSE);
		throw new Error("Project name is required");
	}

	const targetDir = resolve(name);
	if (existsSync(targetDir)) {
		logger.error(`Directory already exists: ${targetDir}`);
		if (exitProcess) process.exit(EXIT.MISUSE);
		throw new Error(`Directory already exists: ${targetDir}`);
	}

	mkdirSync(targetDir, { recursive: true });
	mkdirSync(join(targetDir, "src"), { recursive: true });

	const packageJson = {
		name,
		version: "1.0.0",
		type: "module",
		scripts: {
			start: "bun run src/main.ts",
		},
		dependencies: {
			"@aphrody/bxc": "*",
		},
	};

	const tsconfig = {
		compilerOptions: {
			target: "ESNext",
			module: "ESNext",
			moduleResolution: "Bundler",
			esModuleInterop: true,
			strict: true,
			skipLibCheck: true,
		},
	};

	const mainTs = `import { Actor } from "@aphrody/bxc/sdk/actor";
import { Browser } from "@aphrody/bxc";

await Actor.main(async () => {
	// Get input
	const input = await Actor.getInput<{ url?: string }>() || {};
	const url = input.url || "https://example.com";

	console.log(\`Crawling URL: \${url}\`);

	// Open Bxc browser page
	const page = await Browser.newPage({ mode: "static" });
	await page.goto(url);
	const title = await page.title();

	console.log(\`Page title: \${title}\`);

	// Save output
	await Actor.setValue("OUTPUT", { title, url });
	await Actor.pushData({ title, url, crawledAt: new Date().toISOString() });

	await page.close();
});
`;

	writeFileSync(
		join(targetDir, "package.json"),
		JSON.stringify(packageJson, null, 2),
		"utf8",
	);
	writeFileSync(
		join(targetDir, "tsconfig.json"),
		JSON.stringify(tsconfig, null, 2),
		"utf8",
	);
	writeFileSync(join(targetDir, "src", "main.ts"), mainTs, "utf8");

	logger.log(`Scaffolded Bxc Actor project in: ${targetDir}`);
}
