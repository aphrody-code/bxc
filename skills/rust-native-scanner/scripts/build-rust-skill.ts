import { spawnSync } from "bun";
import { join } from "node:path";

const cargoTomlPath = join(import.meta.dir, "../Cargo.toml");

console.log(`Building Rust Native Scanner at ${cargoTomlPath}...`);

const result = spawnSync(
	["cargo", "build", "--release", "--manifest-path", cargoTomlPath],
	{
		stdout: "inherit",
		stderr: "inherit",
	},
);

if (result.exitCode === 0) {
	console.log("✅ Rust Native Scanner built successfully.");
} else {
	console.error("❌ Build failed.");
	process.exit(1);
}
