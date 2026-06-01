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

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface BxcConfigOptions {
	storageDir?: string;
	purgeOnStart?: boolean;
}

export class BxcConfig {
	private static globalInstance: BxcConfig | null = null;

	private options: Required<BxcConfigOptions>;

	constructor(options: BxcConfigOptions = {}) {
		this.options = {
			storageDir:
				options.storageDir ?? process.env.BXC_STORAGE_DIR ?? "./storage",
			purgeOnStart:
				options.purgeOnStart ??
				process.env.BXC_PURGE_STORAGE_ON_START === "true",
		};

		// Optimize Linux thread pool to maximize async I/O performance
		if (process.platform === "linux" && !process.env.UV_THREADPOOL_SIZE) {
			try {
				const os = require("node:os");
				const cpuCount = os.cpus().length || 4;
				process.env.UV_THREADPOOL_SIZE = String(Math.max(4, cpuCount * 4));
			} catch {}
		}
	}

	get(key: keyof BxcConfigOptions): any {
		return this.options[key];
	}

	set(key: keyof BxcConfigOptions, value: any): void {
		this.options[key] = value as never;
	}

	get storageDir(): string {
		return this.options.storageDir;
	}

	set storageDir(value: string) {
		this.options.storageDir = value;
	}

	get purgeOnStart(): boolean {
		return this.options.purgeOnStart;
	}

	set purgeOnStart(value: boolean) {
		this.options.purgeOnStart = value;
	}

	static getGlobal(): BxcConfig {
		if (!BxcConfig.globalInstance) {
			BxcConfig.globalInstance = new BxcConfig();
		}
		return BxcConfig.globalInstance;
	}

	static setGlobal(config: BxcConfig): void {
		BxcConfig.globalInstance = config;
	}

	/**
	 * Purges the default directories inside storageDir if purgeOnStart is enabled.
	 */
	purgeDefaultStorages(): void {
		if (!this.purgeOnStart) return;

		// Default folders: datasets, key_value_stores, request_queues
		const folders = ["datasets", "key_value_stores", "request_queues"];
		for (const folder of folders) {
			const path = join(this.storageDir, folder);
			if (existsSync(path)) {
				try {
					rmSync(path, { recursive: true, force: true });
				} catch (err) {
					console.warn(
						`[BxcConfig] Failed to purge storage folder ${path}: ${err}`,
					);
				}
			}
		}
	}
}

export const globalConfig = BxcConfig.getGlobal();
