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

/**
 * @module bxc/transport/profile-snapshot
 *
 * Snapshot the session-bearing files of a *running* Chrome profile into a
 * throwaway `--user-data-dir`, so bxc can launch a debug instance against a
 * copy without fighting the singleton lock the live Chrome holds on its real
 * user-data-dir.
 *
 * Why this works on Windows: Chrome opens its SQLite stores (`Cookies`,
 * `Login Data`, …) with `FILE_SHARE_READ`, so they can be copied while it runs;
 * and the cookie-encryption key in `Local State` is sealed with DPAPI, which is
 * bound to the Windows *user* — not to the file path — so the copied cookies
 * stay decryptable by a Chrome launched from the snapshot dir under the same
 * account. The result is a fully logged-in throwaway profile.
 *
 * Only auth/session artefacts are copied (cookies, Local State, prefs, web/login
 * data, Local/Session Storage). Caches and history are skipped — the snapshot is
 * a few MB, not the multi-GB live profile.
 */

import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Profile-root-relative entries that carry an authenticated session. */
const PROFILE_FILES = [
	"Network/Cookies",
	"Network/Cookies-journal",
	"Cookies", // older single-file layout (pre-Network/ split)
	"Cookies-journal",
	"Preferences",
	"Secure Preferences",
	"Login Data",
	"Login Data-journal",
	"Web Data",
	"Web Data-journal",
] as const;

/** Profile-root-relative directories holding SPA auth/session state. */
const PROFILE_DIRS = ["Local Storage", "Session Storage"] as const;

async function copyIfPresent(src: string, dst: string): Promise<boolean> {
	if (!existsSync(src)) return false;
	await mkdir(join(dst, ".."), { recursive: true }).catch(() => undefined);
	await cp(src, dst, { recursive: true, force: true }).catch(() => undefined);
	return existsSync(dst);
}

export interface ProfileSnapshot {
	/** Temp `--user-data-dir` to launch Chrome against. */
	userDataDir: string;
	/** `--profile-directory` inside the snapshot (same name as the source). */
	profileDirectory: string;
	/** Files/dirs actually copied (for diagnostics). */
	copied: string[];
}

/**
 * Copy the session-bearing files of `<userDataDir>/<profileDirectory>` into a
 * fresh temp user-data-dir and return its location. The temp dir lives under the
 * OS temp root; the OS reclaims it — no explicit cleanup is required.
 */
export async function snapshotChromeProfile(
	userDataDir: string,
	profileDirectory: string,
): Promise<ProfileSnapshot> {
	const root = await mkdtemp(join(tmpdir(), "bxc-prof-"));
	const profileDst = join(root, profileDirectory);
	await mkdir(profileDst, { recursive: true });

	const copied: string[] = [];

	// Top-level `Local State` holds the DPAPI-sealed cookie-encryption key.
	if (await copyIfPresent(join(userDataDir, "Local State"), join(root, "Local State"))) {
		copied.push("Local State");
	}

	const srcProfile = join(userDataDir, profileDirectory);
	for (const rel of PROFILE_FILES) {
		if (await copyIfPresent(join(srcProfile, rel), join(profileDst, rel))) copied.push(rel);
	}
	for (const rel of PROFILE_DIRS) {
		if (await copyIfPresent(join(srcProfile, rel), join(profileDst, rel))) copied.push(`${rel}/`);
	}

	return { userDataDir: root, profileDirectory, copied };
}
