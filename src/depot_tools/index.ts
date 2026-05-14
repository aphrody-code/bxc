/**
 * @module bunlight/depot_tools
 *
 * Integration with Google's depot_tools (fetch, gclient, gn, ninja).
 */

import { join } from "path";
import { runPythonScript } from "../python/uv-bridge.ts";

export interface DepotToolsResult {
	status: "success" | "error";
	stdout?: string;
	stderr?: string;
	code?: number;
}

/**
 * Runs a command via gclient using the Python uv bridge.
 */
export async function runGclient(args: string[]): Promise<DepotToolsResult> {
	const res = await runPythonScript<{
		status: string;
		stdout?: string;
		stderr?: string;
		code?: number;
	}>("depot_manager.py", ["gclient", ...args]);

	if (res.status === "error") {
		return { status: "error", stderr: res.error, code: res.code };
	}

	return {
		status: res.data?.status as "success" | "error",
		stdout: res.data?.stdout,
		stderr: res.data?.stderr,
		code: res.data?.code,
	};
}

/**
 * Runs the 'fetch' tool from depot_tools.
 */
export async function runFetch(target: string, args: string[] = []): Promise<DepotToolsResult> {
	const res = await runPythonScript<{
		status: string;
		stdout?: string;
		stderr?: string;
		code?: number;
	}>("depot_manager.py", ["fetch", target, ...args]);

	if (res.status === "error") {
		return { status: "error", stderr: res.error, code: res.code };
	}

	return {
		status: res.data?.status as "success" | "error",
		stdout: res.data?.stdout,
		stderr: res.data?.stderr,
		code: res.data?.code,
	};
}

/**
 * Runs 'git cl' commands.
 */
export async function runGitCl(args: string[]): Promise<DepotToolsResult> {
	const res = await runPythonScript<{
		status: string;
		stdout?: string;
		stderr?: string;
		code?: number;
	}>("depot_manager.py", ["git", "cl", ...args]);

	if (res.status === "error") {
		return { status: "error", stderr: res.error, code: res.code };
	}

	return {
		status: res.data?.status as "success" | "error",
		stdout: res.data?.stdout,
		stderr: res.data?.stderr,
		code: res.data?.code,
	};
}

/**
 * Gets the absolute path to the local depot_tools installation.
 */
export function getDepotToolsPath(): string {
	return join(process.cwd(), "vendor", "depot_tools");
}

/**
 * Helper to build an environment object with depot_tools injected into PATH.
 */
export function getEnvWithDepotTools(): Record<string, string> {
	const path = getDepotToolsPath();
	const env = { ...process.env } as Record<string, string>;
	env.PATH = `${path}:${env.PATH}`;
	return env;
}
