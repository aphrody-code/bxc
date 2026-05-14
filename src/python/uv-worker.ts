/**
 * @module bunlight/python/uv-worker
 *
 * Offloads heavy Python operations (like RAG or ML) to a separate Bun Worker.
 * This prevents the Python Global Interpreter Lock (GIL) from blocking Bun's main event loop.
 */

declare var self: Worker;

import { runPythonNative } from "./uv-bridge.ts";

if (typeof self !== "undefined" && self.postMessage) {
	// We are inside the worker
	self.onmessage = async (event: MessageEvent) => {
		const { id, moduleName, functionName, args } = event.data;
		try {
			const result = await runPythonNative(moduleName, functionName, args);
			self.postMessage({ id, result });
		} catch (error) {
			self.postMessage({ id, result: { status: "error", error: String(error) } });
		}
	};
}
