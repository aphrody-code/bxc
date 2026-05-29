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

import * as fs from "fs";
import { runFullMetagameAnalysis } from "../src/scrapers/worldbeyblade/analytics.ts";

async function main() {
	const archivePath = "/home/ubuntu/bxc/data/thread_archive.html";
	if (!fs.existsSync(archivePath)) {
		console.error(`Error: Archive file not found at ${archivePath}`);
		process.exit(1);
	}

	const html = fs.readFileSync(archivePath, "utf-8");
	const outputPayload = runFullMetagameAnalysis(html);

	console.log(
		`Parsed ${outputPayload.metadata.total_tournaments} tournaments successfully.`,
	);
	console.log(`Log contains ${outputPayload.anomalies.length} anomalies.`);

	const outputPath = "/home/ubuntu/bxc/data/bbx_metagame_data.json";
	fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2));
	console.log(`Saved analytical results to ${outputPath}`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
