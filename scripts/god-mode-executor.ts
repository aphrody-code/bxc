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

import { spawn } from "bun";
import { existsSync, readFileSync } from "fs";

async function run() {
	console.log("GOD MODE EXECUTOR: Starting...");

	let attempts = 0;
	while (!existsSync("src/google/atlas.ts") && attempts < 60) {
		await new Promise(r => setTimeout(r, 5000));
		attempts++;
	}

	if (!existsSync("src/google/atlas.ts")) {
		if (existsSync("google-ecosystem-map.json")) {
			await spawn(["bun", "scripts/post-mapping.ts"]).exited;
		} else {
			process.exit(1);
		}
	}

	const clientPath = "src/google/client.ts";
	if (existsSync(clientPath)) {
		let content = readFileSync(clientPath, "utf-8");
		if (!content.includes("GOOGLE_ATLAS")) {
			content = "import { resolveAtlasRoute } from './atlas.ts';\n" + content;
			content = content.replace(
				/async open\(url: string, opts: any = {}\) \{/,
				"async open(url: string, opts: any = {}) {\n\t\tconst hostname = new URL(url).hostname;\n\t\tconst route = resolveAtlasRoute(hostname);\n\t\tif (route) {\n\t\t\topts.profile = route.framework === 'wiz' ? 'stealth-wiz' : (route.framework === 'angular' ? 'stealth-spa' : 'stealth');\n\t\t}"
			);
			await Bun.write(clientPath, content);
		}
	}

	await spawn(["bun", "test", "test/integration/google-atlas.test.ts"]).exited;
}

run();
