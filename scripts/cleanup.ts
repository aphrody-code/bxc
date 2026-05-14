import { $ } from "bun";
import { rm } from "fs/promises";

console.log("🧹 Cleaning repository...");

const patterns = [
    "dist",
    ".turbo",
    "node_modules",
    "**/*.log",
    "**/tmp",
    "**/temp",
    "**/.DS_Store",
    "coverage",
    "screenshots/*.png",
];

for (const pattern of patterns) {
    try {
        await $`rm -rf ${pattern}`.quiet();
        console.log(`  - Removed ${pattern}`);
    } catch (e) {
        // Skip if not found
    }
}

console.log("✨ Repository cleaned.");
