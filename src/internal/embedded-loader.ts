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

import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	statSync,
	renameSync,
} from "node:fs";
import { join } from "node:path";
import { hasEmbedded } from "../rust/embedded-assets.ts";

/**
 * Extracts an embedded binary asset from Bun's virtual filesystem ($bunfs)
 * to a physical directory (~/.bxc/bin) so that dlopen/kernel dynamic linkers
 * can access it.
 *
 * Safe from race conditions and lockups: writes to a tmp file first,
 * atomic renames, and skips entirely if the target already exists with the exact same size.
 */
export function extractEmbeddedAssetIfNeeded(
	assetPath: string,
	filename: string,
): string {
	if (!hasEmbedded || !assetPath) {
		return assetPath;
	}

	const home = Bun.env.HOME || Bun.env.USERPROFILE || "/tmp";
	const binDir = join(home, ".bxc", "bin");
	const targetPath = join(binDir, filename);

	try {
		const size = Bun.file(assetPath).size;

		// Check if it already exists and has the same size
		try {
			const stat = statSync(targetPath);
			if (stat.size === size) {
				return targetPath;
			}
		} catch {
			// Doesn't exist or is not accessible, proceed to extract
		}

		mkdirSync(binDir, { recursive: true });

		// Read from virtual filesystem (using node:fs readFileSync which Bun supports)
		const data = readFileSync(assetPath);
		const tmpPath = `${targetPath}.tmp.${process.pid}`;
		writeFileSync(tmpPath, data);
		renameSync(tmpPath, targetPath);

		return targetPath;
	} catch (err) {
		console.warn(
			`[bxc] Failed to extract embedded asset "${filename}" from "${assetPath}":`,
			err,
		);
		return assetPath;
	}
}
