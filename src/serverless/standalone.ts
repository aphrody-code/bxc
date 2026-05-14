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
	const envPort = Number(process.env.PORT ?? "");
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
	`[bunlight-serverless] listening on http://${server.hostname}:${server.port}`,
);
