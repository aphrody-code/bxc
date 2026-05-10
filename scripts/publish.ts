#!/usr/bin/env bun
/**
 * Bunlight publish script — dual-registry (GitHub Packages + npm public).
 *
 * Usage:
 *   bun scripts/publish.ts patch   # bump patch version, tag, publish both
 *   bun scripts/publish.ts minor
 *   bun scripts/publish.ts major
 *   bun scripts/publish.ts         # publish current version without bump
 *
 * Prerequisites:
 *   - GH_TOKEN env var (GitHub PAT, packages:write)
 *   - NPM_TOKEN env var (npm automation token)
 *   - Git working tree must be clean
 *   - bun test must pass
 *
 * Bun-native APIs only: Bun.$, Bun.file, Bun.write.
 */

import { $ } from "bun";

type BumpKind = "patch" | "minor" | "major";

const GITHUB_REGISTRY = "https://npm.pkg.github.com";
const NPM_REGISTRY = "https://registry.npmjs.org";
const SCOPE = "@aphrody-code";
const MAX_RETRIES = 3;

async function assertEnv(name: string): Promise<string> {
	const val = process.env[name];
	if (!val) {
		console.error(`Error: environment variable ${name} is not set.`);
		console.error(`See docs/PUBLISHING.md for token setup instructions.`);
		process.exit(1);
	}
	return val;
}

async function assertGitClean(): Promise<void> {
	const result = await $`git status --porcelain`.text();
	if (result.trim().length > 0) {
		console.error("Error: git working tree is not clean. Commit or stash changes first.");
		console.error(result);
		process.exit(1);
	}
}

function bumpVersion(current: string, kind: BumpKind): string {
	const parts = current
		.replace(/^[^0-9]*/, "")
		.split("-")[0]
		.split(".");
	if (parts.length < 3) {
		console.error(`Cannot parse version: ${current}`);
		process.exit(1);
	}
	let [major, minor, patch] = parts.map(Number);
	if (kind === "patch") patch++;
	else if (kind === "minor") {
		minor++;
		patch = 0;
	} else if (kind === "major") {
		major++;
		minor = 0;
		patch = 0;
	}
	const next = `${major}.${minor}.${patch}`;
	// Bun-native semver invariant: the bumped version must order strictly
	// above the previous one. Catches negative bumps from malformed inputs.
	if (Bun.semver.order(next, current) <= 0) {
		console.error(`Refusing to publish: bumped version ${next} is not greater than ${current}`);
		process.exit(1);
	}
	return next;
}

async function readPackageJson(): Promise<
	{ name: string; version: string } & Record<string, unknown>
> {
	const raw = await Bun.file("package.json").text();
	return JSON.parse(raw) as { name: string; version: string } & Record<string, unknown>;
}

async function writePackageVersion(newVersion: string): Promise<void> {
	const raw = await Bun.file("package.json").text();
	const updated = raw.replace(/"version":\s*"[^"]*"/, `"version": "${newVersion}"`);
	await Bun.write("package.json", updated);
}

async function runWithRetry(
	label: string,
	fn: () => Promise<void>,
	retries = MAX_RETRIES,
): Promise<void> {
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			await fn();
			return;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Attempt ${attempt}/${retries} for "${label}" failed: ${message}`);
			if (attempt === retries) {
				console.error(`All ${retries} attempts failed for "${label}". Aborting.`);
				process.exit(1);
			}
			// Brief exponential back-off before retry
			await Bun.sleep(1000 * attempt);
		}
	}
}

async function publishToRegistry(registry: string, token: string, label: string): Promise<void> {
	await runWithRetry(`publish to ${label}`, async () => {
		if (registry === GITHUB_REGISTRY) {
			// Write scoped .npmrc for GitHub Packages
			await Bun.write(
				".npmrc-publish-tmp",
				`${SCOPE}:registry=${GITHUB_REGISTRY}\n//npm.pkg.github.com/:_authToken=${token}\n`,
			);
			await $`bun publish --access public --config .npmrc-publish-tmp`;
		} else {
			await Bun.write(".npmrc-publish-tmp", `//registry.npmjs.org/:_authToken=${token}\n`);
			await $`bun publish --access public --registry ${registry} --config .npmrc-publish-tmp`;
		}
	});
}

async function main(): Promise<void> {
	const bumpArg = process.argv[2] as BumpKind | undefined;
	const validBumps: BumpKind[] = ["patch", "minor", "major"];

	if (bumpArg && !validBumps.includes(bumpArg)) {
		console.error(`Unknown bump kind: ${bumpArg}. Use patch, minor, or major.`);
		process.exit(1);
	}

	// 1. Read tokens from environment
	const ghToken = await assertEnv("GH_TOKEN");
	const npmToken = await assertEnv("NPM_TOKEN");

	// 2. Assert clean working tree
	await assertGitClean();

	// 3. Read current package.json
	const pkg = await readPackageJson();
	let version = pkg.version;

	// 4. Optionally bump version
	if (bumpArg) {
		const newVersion = bumpVersion(version, bumpArg);
		console.log(`Bumping ${version} -> ${newVersion} (${bumpArg})`);
		await writePackageVersion(newVersion);
		version = newVersion;
	} else {
		console.log(`Publishing current version ${version} without bump.`);
	}

	const tagName = `v${version}`;

	// 5. Run test suite
	console.log("Running bun test...");
	await $`bun test`;
	console.log("Tests passed.");

	// 6. Git commit + tag (only when bumping)
	if (bumpArg) {
		await $`git add package.json`;
		await $`git commit -m "chore(release): bump version to ${version}"`;
		await $`git tag ${tagName}`;
		console.log(`Tagged ${tagName}.`);
	}

	// 7. Publish to GitHub Packages
	console.log(`Publishing ${pkg.name}@${version} to GitHub Packages...`);
	await publishToRegistry(GITHUB_REGISTRY, ghToken, "GitHub Packages");
	console.log("Published to GitHub Packages.");

	// 8. Publish to npm public
	console.log(`Publishing ${pkg.name}@${version} to npm...`);
	await publishToRegistry(NPM_REGISTRY, npmToken, "npm");
	console.log("Published to npm.");

	// 9. Cleanup temp .npmrc
	try {
		await $`rm -f .npmrc-publish-tmp`;
	} catch {
		// best-effort cleanup
	}

	// 10. Push tag to remote (if bumped)
	if (bumpArg) {
		console.log(`Pushing tag ${tagName} to origin...`);
		await $`git push origin ${tagName}`;
		console.log("Done. Both registries updated.");
		console.log(`Run: gh release create ${tagName} --generate-notes`);
	} else {
		console.log("Done. Both registries updated.");
	}
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`Fatal: ${message}`);
	process.exit(1);
});
