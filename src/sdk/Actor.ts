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

import {
	existsSync,
	readdirSync,
	rmSync,
	unlinkSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { logger } from "../cli/shared.ts";
import { RequestQueue } from "../queue/RequestQueue.ts";
import { EventEmitter } from "node:events";

export interface ActorEnv {
	actorId?: string;
	actorRunId?: string;
	actorTaskId?: string;
	userId?: string;
	token?: string;
	startedAt?: Date;
	finishedAt?: Date;
	defaultKeyValueStoreId: string;
	defaultDatasetId: string;
	defaultRequestQueueId: string;
	inputKey: string;
	localStorageDir: string;
	memoryMbytes?: number;
	buildId?: string;
	buildNumber?: string;
	containerPort?: number;
	isAtHome: boolean;
}

export interface ProxyConfigurationOptions {
	proxyUrls?: string[];
	newUrlFunction?: (sessionId?: string) => string;
	password?: string;
	groups?: string[];
	countryCode?: string;
}

export class ProxyConfiguration {
	private proxyUrls: string[];
	private newUrlFunction?: (sessionId?: string) => string;

	constructor(options: ProxyConfigurationOptions = {}) {
		this.proxyUrls = options.proxyUrls ?? [];
		this.newUrlFunction = options.newUrlFunction;
	}

	async newUrl(sessionId?: string): Promise<string | undefined> {
		if (this.newUrlFunction) {
			return this.newUrlFunction(sessionId);
		}
		if (this.proxyUrls.length === 0) {
			return undefined;
		}
		if (sessionId) {
			let hash = 0;
			for (let i = 0; i < sessionId.length; i++) {
				hash = sessionId.charCodeAt(i) + ((hash << 5) - hash);
			}
			const idx = Math.abs(hash) % this.proxyUrls.length;
			return this.proxyUrls[idx];
		}
		const idx = Math.floor(Math.random() * this.proxyUrls.length);
		return this.proxyUrls[idx];
	}
}

export class KeyValueStore {
	constructor(
		public id: string,
		private storageDir: string,
	) {}

	async getValue<T = any>(key: string): Promise<T | null> {
		const jsonPath = join(
			this.storageDir,
			"key_value_stores",
			this.id,
			`${key}.json`,
		);
		if (existsSync(jsonPath)) {
			try {
				const content = readFileSync(jsonPath, "utf8");
				return JSON.parse(content) as T;
			} catch {
				return null;
			}
		}
		const rawPath = join(this.storageDir, "key_value_stores", this.id, key);
		if (existsSync(rawPath)) {
			try {
				const content = readFileSync(rawPath, "utf8");
				try {
					return JSON.parse(content) as T;
				} catch {
					return content as any as T;
				}
			} catch {
				return null;
			}
		}
		return null;
	}

	async setValue(
		key: string,
		value: any,
		options?: { contentType?: string },
	): Promise<void> {
		const storeDir = join(this.storageDir, "key_value_stores", this.id);
		if (!existsSync(storeDir)) {
			mkdirSync(storeDir, { recursive: true });
		}
		const jsonPath = join(storeDir, `${key}.json`);
		const rawPath = join(storeDir, key);

		if (value === null || value === undefined) {
			if (existsSync(jsonPath)) {
				try {
					unlinkSync(jsonPath);
				} catch {}
			}
			if (existsSync(rawPath)) {
				try {
					unlinkSync(rawPath);
				} catch {}
			}
			return;
		}

		const contentType = options?.contentType;
		const isBuffer = Buffer.isBuffer(value);
		const isJson =
			!isBuffer &&
			(!contentType ||
				contentType.includes("json") ||
				typeof value === "object" ||
				typeof value === "number" ||
				typeof value === "boolean");

		if (isJson) {
			writeFileSync(jsonPath, JSON.stringify(value, null, 2), "utf8");
			if (existsSync(rawPath)) {
				try {
					unlinkSync(rawPath);
				} catch {}
			}
		} else {
			if (isBuffer) {
				writeFileSync(rawPath, value);
			} else {
				writeFileSync(rawPath, String(value), "utf8");
			}
			if (existsSync(jsonPath)) {
				try {
					unlinkSync(jsonPath);
				} catch {}
			}
		}
	}

	async drop(): Promise<void> {
		const storeDir = join(this.storageDir, "key_value_stores", this.id);
		if (existsSync(storeDir)) {
			rmSync(storeDir, { recursive: true, force: true });
		}
	}
}

export class Dataset {
	constructor(
		public id: string,
		private storageDir: string,
	) {}

	async pushData(data: any | any[]): Promise<void> {
		const datasetDir = join(this.storageDir, "datasets", this.id);
		if (!existsSync(datasetDir)) {
			mkdirSync(datasetDir, { recursive: true });
		}

		let maxIndex = 0;
		try {
			const files = readdirSync(datasetDir);
			for (const file of files) {
				if (file.endsWith(".json")) {
					const num = parseInt(file.replace(".json", ""), 10);
					if (!isNaN(num) && num > maxIndex) {
						maxIndex = num;
					}
				}
			}
		} catch {}

		const items = Array.isArray(data) ? data : [data];
		let nextIndex = maxIndex + 1;
		for (const item of items) {
			const filename = `${String(nextIndex).padStart(9, "0")}.json`;
			writeFileSync(
				join(datasetDir, filename),
				JSON.stringify(item, null, 2),
				"utf8",
			);
			nextIndex++;
		}
	}

	async getData(options?: {
		limit?: number;
		offset?: number;
	}): Promise<{ items: any[] }> {
		const datasetDir = join(this.storageDir, "datasets", this.id);
		if (!existsSync(datasetDir)) {
			return { items: [] };
		}

		let files: string[] = [];
		try {
			files = readdirSync(datasetDir)
				.filter((f) => f.endsWith(".json"))
				.sort((a, b) => {
					const numA = parseInt(a.replace(".json", ""), 10);
					const numB = parseInt(b.replace(".json", ""), 10);
					return numA - numB;
				});
		} catch {
			return { items: [] };
		}

		let items: any[] = [];
		for (const file of files) {
			try {
				const content = readFileSync(join(datasetDir, file), "utf8");
				items.push(JSON.parse(content));
			} catch {}
		}

		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? items.length;
		items = items.slice(offset, offset + limit);
		return { items };
	}

	async exportToJson(
		outputPath: string,
		options?: { limit?: number; offset?: number },
	): Promise<void> {
		const { items } = await this.getData(options);
		writeFileSync(outputPath, JSON.stringify(items, null, 2), "utf8");
	}

	async exportToCsv(
		outputPath: string,
		options?: { limit?: number; offset?: number },
	): Promise<void> {
		const { items } = await this.getData(options);
		if (items.length === 0) {
			writeFileSync(outputPath, "", "utf8");
			return;
		}

		const headers = Object.keys(items[0]);
		const escape = (v: unknown): string => {
			const s = v === null || v === undefined ? "" : String(v);
			if (
				s.includes(",") ||
				s.includes('"') ||
				s.includes("\n") ||
				s.includes("\r")
			) {
				return `"${s.replace(/"/g, '""')}"`;
			}
			return s;
		};

		const csvLines = [
			headers.map(escape).join(","),
			...items.map((row) => headers.map((h) => escape(row[h])).join(",")),
		];
		writeFileSync(outputPath, csvLines.join("\n") + "\n", "utf8");
	}

	async exportToXml(
		outputPath: string,
		options?: { limit?: number; offset?: number },
	): Promise<void> {
		const { items } = await this.getData(options);
		const escapeXml = (v: unknown): string => {
			const s = v === null || v === undefined ? "" : String(v);
			return s
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&apos;");
		};

		let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<items>\n';
		for (const item of items) {
			xml += "  <item>\n";
			for (const [k, v] of Object.entries(item)) {
				xml += `    <${k}>${escapeXml(v)}</${k}>\n`;
			}
			xml += "  </item>\n";
		}
		xml += "</items>\n";
		writeFileSync(outputPath, xml, "utf8");
	}

	async exportToHtml(
		outputPath: string,
		options?: { limit?: number; offset?: number },
	): Promise<void> {
		const { items } = await this.getData(options);
		if (items.length === 0) {
			writeFileSync(
				outputPath,
				"<!DOCTYPE html>\n<html>\n<body>\n<p>No data</p>\n</body>\n</html>\n",
				"utf8",
			);
			return;
		}

		const headers = Object.keys(items[0]);
		const escapeHtml = (v: unknown): string => {
			const s = v === null || v === undefined ? "" : String(v);
			return s
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		};

		let html = "<!DOCTYPE html>\n<html>\n<head>\n<style>\n";
		html +=
			"table { border-collapse: collapse; width: 100%; font-family: sans-serif; }\n";
		html +=
			"th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }\n";
		html += "tr:nth-child(even) { background-color: #f2f2f2; }\n";
		html += "th { background-color: #4CAF50; color: white; }\n";
		html += "</style>\n</head>\n<body>\n";
		html += "<table>\n  <thead>\n    <tr>\n";
		for (const h of headers) {
			html += `      <th>${escapeHtml(h)}</th>\n`;
		}
		html += "    </tr>\n  </thead>\n  <tbody>\n";
		for (const item of items) {
			html += "    <tr>\n";
			for (const h of headers) {
				html += `      <td>${escapeHtml(item[h])}</td>\n`;
			}
			html += "    </tr>\n";
		}
		html += "  </tbody>\n</table>\n</body>\n</html>\n";
		writeFileSync(outputPath, html, "utf8");
	}

	async drop(): Promise<void> {
		const datasetDir = join(this.storageDir, "datasets", this.id);
		if (existsSync(datasetDir)) {
			rmSync(datasetDir, { recursive: true, force: true });
		}
	}
}

export class Actor {
	private static isInitialized = false;
	private static isExited = false;
	private static startedAt?: Date;
	private static finishedAt?: Date;

	private static states = new Map<string, any>();
	private static stateListenersRegistered = false;
	private static eventsInterval?: any;
	static events = new EventEmitter();

	static on(event: string, listener: (...args: any[]) => void): void {
		this.events.on(event, listener);
	}

	static off(event: string, listener: (...args: any[]) => void): void {
		this.events.off(event, listener);
	}

	static isAtHome(): boolean {
		return this.getEnv().isAtHome;
	}

	static getEnv(): ActorEnv {
		const localStorageDir =
			process.env.BXC_STORAGE_DIR ||
			process.env.APIFY_LOCAL_STORAGE_DIR ||
			"./storage";
		const isAtHome =
			process.env.APIFY_IS_AT_HOME === "1" ||
			process.env.ACTOR_IS_AT_HOME === "1";
		const memoryMbytes = process.env.APIFY_MEMORY_MBYTES
			? parseInt(process.env.APIFY_MEMORY_MBYTES, 10)
			: undefined;
		const containerPort = process.env.APIFY_CONTAINER_PORT
			? parseInt(process.env.APIFY_CONTAINER_PORT, 10)
			: undefined;

		return {
			actorId: process.env.APIFY_ACTOR_ID || process.env.ACTOR_ID,
			actorRunId: process.env.APIFY_ACTOR_RUN_ID || process.env.ACTOR_RUN_ID,
			actorTaskId: process.env.APIFY_ACTOR_TASK_ID || process.env.ACTOR_TASK_ID,
			userId: process.env.APIFY_USER_ID,
			token: process.env.APIFY_TOKEN,
			startedAt: this.startedAt,
			finishedAt: this.finishedAt,
			defaultKeyValueStoreId:
				process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID || "default",
			defaultDatasetId: process.env.APIFY_DEFAULT_DATASET_ID || "default",
			defaultRequestQueueId: process.env.APIFY_DEFAULT_QUEUE_ID || "default",
			inputKey: process.env.APIFY_INPUT_KEY || "INPUT",
			localStorageDir,
			memoryMbytes,
			buildId: process.env.APIFY_BUILD_ID,
			buildNumber: process.env.APIFY_BUILD_NUMBER,
			containerPort,
			isAtHome,
		};
	}

	static async init(): Promise<void> {
		if (this.isInitialized) return;
		this.startedAt = new Date();
		this.isInitialized = true;
		this.isExited = false;

		const env = this.getEnv();
		logger.log("Actor: Initializing run stats & storage emulation...");

		// Standard local emulation behavior is to purge default stores on start
		const purgeOnStart =
			process.env.APIFY_PURGE_ON_START !== "0" &&
			process.env.APIFY_PURGE_ON_START !== "false";
		if (purgeOnStart) {
			this.purgeLocalStorage();
		}

		// Setup periodic event emitter loops (mimicking Apify client behaviour)
		this.eventsInterval = setInterval(() => {
			this.events.emit("cpuInfo", {
				limitRatio: 1.0,
				actualRatio: 0.1,
				isOverloaded: false,
			});
			this.events.emit("persistState", { isMigration: false });
		}, 60000);
		if (this.eventsInterval.unref) {
			this.eventsInterval.unref();
		}

		// Register default state persist listeners
		this.registerStatePersistListeners();
	}

	private static purgeLocalStorage(): void {
		const env = this.getEnv();
		const storageDir = env.localStorageDir;

		// Purge default key-value store except INPUT files
		const kvsId = env.defaultKeyValueStoreId;
		const kvsDir = join(storageDir, "key_value_stores", kvsId);
		if (existsSync(kvsDir)) {
			try {
				const files = readdirSync(kvsDir);
				for (const file of files) {
					if (!file.startsWith("INPUT")) {
						rmSync(join(kvsDir, file), { recursive: true, force: true });
					}
				}
			} catch {}
		}

		// Purge default dataset
		const datasetId = env.defaultDatasetId;
		const datasetDir = join(storageDir, "datasets", datasetId);
		if (existsSync(datasetDir)) {
			try {
				rmSync(datasetDir, { recursive: true, force: true });
			} catch {}
		}

		// Purge default request queue
		const queueId = env.defaultRequestQueueId;
		const queueDir = join(storageDir, "request_queues", queueId);
		if (existsSync(queueDir)) {
			try {
				rmSync(queueDir, { recursive: true, force: true });
			} catch {}
		}
	}

	static async exit(options?: { exitProcess?: boolean }): Promise<void> {
		if (this.isExited) return;
		this.finishedAt = new Date();
		this.isExited = true;

		if (this.eventsInterval) {
			clearInterval(this.eventsInterval);
			this.eventsInterval = undefined;
		}

		// Save state
		await this.persistState();

		// Write run metadata
		const env = this.getEnv();
		const runId = env.actorRunId || "default";
		const metadataPath = join(
			env.localStorageDir,
			"runs",
			runId,
			"metadata.json",
		);

		try {
			const metadataDir = dirname(metadataPath);
			if (!existsSync(metadataDir)) {
				mkdirSync(metadataDir, { recursive: true });
			}
			const durationMs = this.startedAt
				? this.finishedAt.getTime() - this.startedAt.getTime()
				: 0;
			writeFileSync(
				metadataPath,
				JSON.stringify(
					{
						status: "SUCCEEDED",
						startedAt: this.startedAt?.toISOString(),
						finishedAt: this.finishedAt.toISOString(),
						durationMs,
					},
					null,
					2,
				),
				"utf8",
			);
		} catch {}

		const duration = this.startedAt
			? this.finishedAt.getTime() - this.startedAt.getTime()
			: 0;
		logger.log(`Actor: Run completed successfully. Duration: ${duration} ms.`);

		const exitProcess = options?.exitProcess ?? process.env.NODE_ENV !== "test";
		if (exitProcess) {
			process.exit(0);
		}
	}

	static async fail(
		errorOrMessage?: any,
		options?: { exitCode?: number; exitProcess?: boolean },
	): Promise<void> {
		this.finishedAt = new Date();
		const errorMsg =
			errorOrMessage instanceof Error
				? errorOrMessage.message
				: String(errorOrMessage || "Unknown error");
		const errorStack =
			errorOrMessage instanceof Error ? errorOrMessage.stack : undefined;

		if (this.eventsInterval) {
			clearInterval(this.eventsInterval);
			this.eventsInterval = undefined;
		}

		// Save state
		await this.persistState();

		// Write run metadata
		const env = this.getEnv();
		const runId = env.actorRunId || "default";
		const metadataPath = join(
			env.localStorageDir,
			"runs",
			runId,
			"metadata.json",
		);

		try {
			const metadataDir = dirname(metadataPath);
			if (!existsSync(metadataDir)) {
				mkdirSync(metadataDir, { recursive: true });
			}
			const durationMs = this.startedAt
				? this.finishedAt.getTime() - this.startedAt.getTime()
				: 0;
			writeFileSync(
				metadataPath,
				JSON.stringify(
					{
						status: "FAILED",
						startedAt: this.startedAt?.toISOString(),
						finishedAt: this.finishedAt.toISOString(),
						durationMs,
						error: errorMsg,
						stack: errorStack,
					},
					null,
					2,
				),
				"utf8",
			);
		} catch {}

		logger.error(`Actor: Run failed. Error: ${errorMsg}`);

		const exitCode = options?.exitCode ?? 1;
		const exitProcess = options?.exitProcess ?? process.env.NODE_ENV !== "test";
		if (exitProcess) {
			process.exit(exitCode);
		} else {
			throw new Error(errorMsg);
		}
	}

	static async main(fn: () => Promise<void> | void): Promise<void> {
		try {
			await this.init();
			await fn();
			await this.exit();
		} catch (err) {
			await this.fail(err);
		}
	}

	static async getInput<T = any>(): Promise<T | null> {
		// 1. Check environment variables
		const envInput =
			process.env.BXC_INPUT ||
			process.env.APIFY_INPUT ||
			process.env.ACTOR_INPUT;
		if (envInput) {
			try {
				return JSON.parse(envInput) as T;
			} catch {
				return envInput as any as T;
			}
		}

		// 2. Read from default key-value store
		const env = this.getEnv();
		const store = this.openKeyValueStore(env.defaultKeyValueStoreId);
		return store.getValue<T>(env.inputKey);
	}

	static async setValue(
		key: string,
		value: any,
		options?: { contentType?: string },
	): Promise<void> {
		const env = this.getEnv();
		const store = this.openKeyValueStore(env.defaultKeyValueStoreId);
		return store.setValue(key, value, options);
	}

	static async pushData(data: any | any[]): Promise<void> {
		const env = this.getEnv();
		const dataset = this.openDataset(env.defaultDatasetId);
		return dataset.pushData(data);
	}

	static openKeyValueStore(id?: string): KeyValueStore {
		const env = this.getEnv();
		return new KeyValueStore(
			id || env.defaultKeyValueStoreId,
			env.localStorageDir,
		);
	}

	static openDataset(id?: string): Dataset {
		const env = this.getEnv();
		return new Dataset(id || env.defaultDatasetId, env.localStorageDir);
	}

	static async openRequestQueue(
		id?: string,
		options?: { maxRetries?: number; lockTimeoutMs?: number },
	): Promise<RequestQueue> {
		const env = this.getEnv();
		return RequestQueue.open(id || env.defaultRequestQueueId, {
			storageDir: env.localStorageDir,
			...options,
		});
	}

	static async useState<T = any>(key: string, defaultValue: T): Promise<T> {
		if (this.states.has(key)) {
			return this.states.get(key);
		}
		const env = this.getEnv();
		const store = this.openKeyValueStore(env.defaultKeyValueStoreId);
		const value = await store.getValue<T>(key);
		const state = value !== null ? value : defaultValue;
		this.states.set(key, state);
		return state;
	}

	static async createProxyConfiguration(
		options?: ProxyConfigurationOptions,
	): Promise<ProxyConfiguration> {
		return new ProxyConfiguration(options);
	}

	static async metamorph(
		targetActorId: string,
		input?: any,
		options?: { build?: string },
	): Promise<void> {
		logger.log(
			`Actor.metamorph called to run target: ${targetActorId}. Emulating metamorph locally.`,
		);
		if (input) {
			const env = this.getEnv();
			const store = this.openKeyValueStore(env.defaultKeyValueStoreId);
			await store.setValue(env.inputKey, input);
		}
	}

	static async addWebhook(options: {
		eventTypes: string[];
		requestUrl: string;
		payloadTemplate?: string;
	}): Promise<void> {
		logger.log(
			`Actor.addWebhook registered for events: [${options.eventTypes.join(", ")}] -> ${options.requestUrl}`,
		);
	}

	private static async persistState(): Promise<void> {
		const env = this.getEnv();
		const store = this.openKeyValueStore(env.defaultKeyValueStoreId);
		for (const [key, state] of this.states.entries()) {
			await store.setValue(key, state);
		}
	}

	private static registerStatePersistListeners(): void {
		if (this.stateListenersRegistered) return;
		this.stateListenersRegistered = true;

		// Listen to events persistState trigger
		this.events.on("persistState", async () => {
			try {
				await this.persistState();
			} catch {}
		});
	}
}
