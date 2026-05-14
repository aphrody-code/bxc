import { describe, expect, test } from "bun:test";
import { getDepotToolsPath, runGclient } from "../../src/depot_tools/index.ts";
import { runPythonScript } from "../../src/python/uv-bridge.ts";

describe("Python uv Bridge", () => {
	test("Can execute python script", async () => {
		const res = await runPythonScript("depot_manager.py", []);
		// It exits with code 1, so the status is error. We can check the error message.
		expect(res.status).toBe("error");
		expect(res.error).toContain("No command provided");
	});
});

describe("Depot Tools Integration", () => {
	test("getDepotToolsPath returns a valid path", async () => {
		const path = getDepotToolsPath();
		expect(path).toContain("vendor/depot_tools");
		expect(await Bun.file(`${path}/gclient`).exists()).toBe(true);
	});

	test("runGclient returns version info", async () => {
		const res = await runGclient(["--version"]);
		expect(res.status).toBe("success");
		expect(res.stdout).toContain("gclient.py");
	}, 15000);
});
