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
 * Standalone entry — `bun src/serverless/standalone.ts` or
 * `bun build --compile src/serverless/standalone.ts`.
 *
 * Reads PORT (env or `--port N`) and starts Bun.serve over the handler.
 */

import { handler } from "./handler.ts";

function parsePort(): number {
	const argIdx = process.argv.indexOf("--port");
	if (argIdx >= 0) {
		const v = Number(process.argv[argIdx + 1]);
		if (Number.isFinite(v) && v > 0) return v;
	}
	const envPort = Number(Bun.env.PORT ?? "");
	if (Number.isFinite(envPort) && envPort > 0) return envPort;
	return 3000;
}

const port = parsePort();

const server = Bun.serve({
	port,
	idleTimeout: 30,
	fetch: handler,
});

console.log(
	`[bxc-serverless] listening on http://${server.hostname}:${server.port}`,
);
