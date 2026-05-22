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
 * @module bxc/config/hardware
 *
 * Hardware-aware tuning. Detects the host (CPU cores, total RAM, OS, GPU) and
 * derives Chrome launch flags, the V8 heap ceiling, and a default concurrency
 * so bxc exploits the machine instead of using conservative server defaults.
 *
 * Reference target this was tuned for: Windows 11, 8-core i7, 16 GB RAM,
 * NVIDIA GPU. Every value is overridable by env so it stays portable to VPS /
 * CI (where you typically want the GPU off and a smaller heap).
 *
 * Env overrides:
 *   BXC_GPU=off|on            force GPU acceleration off/on (default: on, except headless Linux)
 *   BXC_V8_HEAP_MB=<n>        V8 --max-old-space-size in MB (default: ~50% RAM, capped 4096)
 *   BXC_CONCURRENCY=<n>       default parallel-task concurrency (default: cores)
 *   BXC_ANGLE_BACKEND=d3d11|gl|vulkan   ANGLE backend on Windows (default: d3d11 for NVIDIA)
 */

import { cpus, totalmem } from "node:os";

export interface HardwareProfile {
	platform: NodeJS.Platform;
	cores: number;
	totalRamMb: number;
	gpuEnabled: boolean;
	/** ANGLE backend hint for Windows (`d3d11` is the NVIDIA-friendly default). */
	angleBackend: "d3d11" | "gl" | "vulkan";
}

let cached: HardwareProfile | null = null;

function envFlag(name: string): boolean | undefined {
	const v = Bun.env[name]?.toLowerCase();
	if (v === undefined || v === "") return undefined;
	if (v === "off" || v === "0" || v === "false" || v === "no") return false;
	if (v === "on" || v === "1" || v === "true" || v === "yes") return true;
	return undefined;
}

/** Detect (and memoise) the host hardware profile. */
export function hardware(): HardwareProfile {
	if (cached) return cached;

	const cores = Math.max(1, cpus().length || 1);
	const totalRamMb = Math.round(totalmem() / (1024 * 1024));
	const platform = process.platform;

	// GPU on by default on desktop OSes; off by default on Linux (usually a
	// headless server with no GPU). Always honour an explicit BXC_GPU.
	const gpuOverride = envFlag("BXC_GPU");
	const gpuEnabled =
		gpuOverride ?? (platform === "win32" || platform === "darwin");

	const angleEnv = Bun.env["BXC_ANGLE_BACKEND"]?.toLowerCase();
	const angleBackend =
		angleEnv === "gl" || angleEnv === "vulkan" || angleEnv === "d3d11"
			? (angleEnv as HardwareProfile["angleBackend"])
			: "d3d11";

	cached = { platform, cores, totalRamMb, gpuEnabled, angleBackend };
	return cached;
}

/**
 * V8 old-space ceiling (MB) for engine/Chrome JS. ~50 % of RAM, capped at
 * 4096 MB (V8's practical single-heap sweet spot) and floored at 512 MB.
 * On 16 GB this yields 4096.
 */
export function v8HeapMb(): number {
	const override = Number.parseInt(Bun.env["BXC_V8_HEAP_MB"] ?? "", 10);
	if (Number.isFinite(override) && override > 0) return override;
	const half = Math.floor(hardware().totalRamMb / 2);
	return Math.min(4096, Math.max(512, half));
}

/** Default parallel-task concurrency. Defaults to the core count. */
export function defaultConcurrency(): number {
	const override = Number.parseInt(Bun.env["BXC_CONCURRENCY"] ?? "", 10);
	if (Number.isFinite(override) && override > 0) return override;
	return hardware().cores;
}

/**
 * Chrome launch flags that turn on GPU-accelerated rasterisation/compositing.
 * On Windows with an NVIDIA GPU this routes through ANGLE→D3D11 and unblocks
 * the GPU even when Chrome's blocklist would otherwise disable it.
 *
 * Returns an empty array when the GPU is disabled (e.g. headless VPS).
 */
export function chromeGpuFlags(): string[] {
	const hw = hardware();
	if (!hw.gpuEnabled) {
		return ["--disable-gpu"];
	}
	const flags = [
		"--enable-gpu",
		"--ignore-gpu-blocklist",
		"--enable-gpu-rasterization",
		"--enable-zero-copy",
		"--enable-features=CanvasOopRasterization",
	];
	if (hw.platform === "win32") {
		flags.push(`--use-angle=${hw.angleBackend}`);
	}
	return flags;
}

/** Chrome `--js-flags` value sizing the V8 heap to the host RAM. */
export function chromeJsFlags(): string {
	return `--max-old-space-size=${v8HeapMb()}`;
}

/** One-line human summary, for `bxc detect` / logs. */
export function describeHardware(): string {
	const hw = hardware();
	return `bxc hardware: ${hw.cores} cores, ${(hw.totalRamMb / 1024).toFixed(
		1,
	)} GB RAM, ${hw.platform}, GPU ${hw.gpuEnabled ? `on (angle=${hw.angleBackend})` : "off"}; V8 heap ${v8HeapMb()} MB, concurrency ${defaultConcurrency()}`;
}
