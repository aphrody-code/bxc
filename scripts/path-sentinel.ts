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

import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Path Sentinel v1.0
 *
 * Scans the codebase for:
 * 1. Hardcoded home directory paths (~ or ${process.env.HOME || '/home/ubuntu'})
 * 2. Inconsistent relative paths in imports/FFI
 * 3. Absolute paths that should be project-relative
 *
 * Automatically corrects them using project-root awareness.
 */

const PROJECT_ROOT = process.cwd();
const USER_HOME = process.env.HOME || "${process.env.HOME || '/home/ubuntu'}";

async function scanAndFix() {
	console.log("🛡️ PATH SENTINEL: Initializing scan...");

	const files =
		await $`find src test scripts examples -type f -name "*.ts" -o -name "*.js"`.text();
	const fileList = files.split("\n").filter(Boolean);

	let fixCount = 0;

	for (const file of fileList) {
		const fullPath = join(PROJECT_ROOT, file);
		let content = readFileSync(fullPath, "utf-8");
		let original = content;

		// 1. Fix hardcoded home directory paths
		const homePattern = new RegExp(USER_HOME, "g");
		if (homePattern.test(content)) {
			console.log(`  [home] Fixing hardcoded home in ${file}`);
			content = content.replace(
				homePattern,
				"${process.env.HOME || '${process.env.HOME || '/home/ubuntu'}'}",
			);
		}

		// 2. Fix specific absolute paths to project root
		if (content.includes(PROJECT_ROOT)) {
			console.log(
				`  [root] Converting absolute project path to relative in ${file}`,
			);
			// Special logic for FFI path resolution usually uses import.meta.dir
			content = content.split(PROJECT_ROOT).join(".");
		}

		// 3. License Header Injection (Google/Apache standard)
		if (!content.startsWith("/**\n * Copyright")) {
			const header = `/**
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
 */\n\n`;
			content = header + content;
			fixCount++;
		}

		if (content !== original) {
			writeFileSync(fullPath, content);
			fixCount++;
		}
	}

	console.log(
		`✅ PATH SENTINEL: Task complete. Applied ${fixCount} corrections.`,
	);
}

scanAndFix().catch(console.error);
