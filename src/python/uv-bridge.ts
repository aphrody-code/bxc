/**
 * @module bunlight/python/uv-bridge
 *
 * Bridge to execute Python scripts managed by `uv`.
 */

import { spawn } from "child_process";
import { join } from "path";
import { python } from "bun_python";

export interface PythonResult<T = unknown> {
	status: "success" | "error";
	data?: T;
	error?: string;
	code?: number;
}

/**
 * Runs a python function natively using bun_python.
 * This is faster as it doesn't spawn a new process for every call.
 */
export async function runPythonNative<T = unknown>(
	moduleName: string,
	functionName: string,
	args: any[] = [],
): Promise<PythonResult<T>> {
	try {
		const bridgePath = join(process.cwd(), "python-bridge");
		// Path to uv venv site-packages (to be updated if python version changes)
		const venvSitePackages = join(bridgePath, ".venv/lib/python3.12/site-packages");

		python.run(`
import sys
import os
for p in ["${bridgePath}", "${venvSitePackages}"]:
    if p not in sys.path:
        sys.path.append(p)
`);

		const mod = python.import(moduleName);
		const func = mod[functionName];
		const result = func(...args);

		return {
			status: "success",
			data: result as T,
		};
	} catch (err) {
		return {
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// Global worker instance for heavy Python tasks
let pythonWorker: Worker | null = null;
let workerMsgId = 0;
const workerCallbacks = new Map<number, (res: any) => void>();

/**
 * Runs a Python function in a separate Bun Worker.
 * MUST be used for Heavy/ML/RAG tasks to prevent Python GIL from blocking the Bun event loop.
 */
export async function runPythonWorker<T = unknown>(
	moduleName: string,
	functionName: string,
	args: any[] = [],
): Promise<PythonResult<T>> {
	if (!pythonWorker) {
		pythonWorker = new Worker(join(__dirname, "uv-worker.ts"));
		pythonWorker.onmessage = (event) => {
			const { id, result } = event.data;
			const cb = workerCallbacks.get(id);
			if (cb) {
				workerCallbacks.delete(id);
				cb(result);
			}
		};
	}

	return new Promise((resolve) => {
		const id = ++workerMsgId;
		workerCallbacks.set(id, resolve);
		pythonWorker!.postMessage({ id, moduleName, functionName, args });
	});
}

/**
 * Terminate the Python worker if running.
 */
export function terminatePythonWorker() {
	if (pythonWorker) {
		pythonWorker.terminate();
		pythonWorker = null;
	}
}

/**
 * Runs a python script using `uv run` inside the python-bridge directory.
 *
 * @param scriptName Name of the script (e.g., "depot_manager.py")
 * @param args Arguments to pass to the script
 */
export async function runPythonScript<T = unknown>(
	scriptName: string,
	args: string[] = [],
): Promise<PythonResult<T>> {
	const cwd = join(process.cwd(), "python-bridge");

	const uvPath = `${process.env.HOME}/.local/bin/uv`;

	const proc = Bun.spawn([uvPath, "run", scriptName, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdoutPromise = proc.stdout ? Bun.readableStreamToText(proc.stdout) : Promise.resolve("");
	const stderrPromise = proc.stderr ? Bun.readableStreamToText(proc.stderr) : Promise.resolve("");

	const code = await proc.exited;
	const stdout = await stdoutPromise;
	const stderr = await stderrPromise;

	if (code !== 0) {
		return {
			status: "error",
			error: stderr || stdout || `Process exited with code ${code}`,
			code,
		};
	}

	try {
		const json = JSON.parse(stdout.trim());
		return {
			status: "success",
			data: json as T,
		};
	} catch (e) {
		return {
			status: "success",
			data: stdout.trim() as unknown as T,
		};
	}
}
