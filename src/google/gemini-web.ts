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
 * @module bxc/google/gemini-web
 *
 * Direct connection to the Gemini web app (gemini.google.com).
 */

import { loadCookieJar, type Cookie } from "../cookies/cookie-loader.ts";

export const GEMINI_HOST = "https://gemini.google.com";
export const GEMINI_APP_URL = `${GEMINI_HOST}/app`;
export const STREAM_GENERATE_PATH = "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
export const GEMINI_COOKIE_HOST = "gemini.google.com";

export const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

export const DEFAULT_BL = "boq_assistant-bard-web-server_20240625.13_p0";

const SNLM0E_RE = /"SNlM0e":"([^"]+)"/;
const CFB2H_RE = /"cfb2h":"([^"]+)"/;

export class GeminiWebError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GeminiWebError";
	}
}

export interface ConversationHistory {
	cid: string;
	title: string;
	updated_at: number;
}

export class GeminiWebClient {
	public model: string;
	public clientUuid: string;
	private cookies: Cookie[] = [];
	private userAgent: string;
	private at: string | null = null;
	private bl: string | null = null;

	// Conversation continuation ids
	private cid: string | null = null;
	private rid: string | null = null;
	private rcid: string | null = null;
	public lastTitle: string | null = null;

	constructor(opts: {
		model?: string;
		cookies?: Cookie[];
		userAgent?: string;
		clientUuid?: string;
	} = {}) {
		this.model = opts.model ?? "flash";
		this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
		this.clientUuid = opts.clientUuid ?? "00000000-0000-4000-8000-000000000001";
		if (opts.cookies) {
			this.cookies = opts.cookies;
		}
	}

	async init(): Promise<void> {
		if (this.cookies.length === 0) {
			try {
				this.cookies = await loadCookieJar("google");
			} catch (err) {
				throw new GeminiWebError(
					`Failed to load Google cookies: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
		this.requireCookies();
	}

	private requireCookies(): void {
		const hasSecureId = this.cookies.some((c) => c.name === "__Secure-1PSID");
		if (!hasSecureId) {
			throw new GeminiWebError(
				"missing required cookie(s): __Secure-1PSID (have " +
					this.cookies.length +
					" cookie(s); re-import from Chrome or import via Cookie-Editor)"
			);
		}
	}

	private getCookieHeader(host: string): string {
		const applicable = this.cookies.filter((c) => {
			const d = c.domain.toLowerCase().replace(/^\./, "");
			const h = host.toLowerCase();
			return h === d || h.endsWith("." + d);
		});
		if (applicable.length === 0) {
			throw new GeminiWebError(`no stored cookie applies to host ${host}`);
		}
		return applicable.map((c) => `${c.name}=${c.value}`).join("; ");
	}

	private getBaseHeaders(): Record<string, string> {
		return {
			"User-Agent": this.userAgent,
			Cookie: this.getCookieHeader(GEMINI_COOKIE_HOST),
		};
	}

	close(): void {
		// No-op in JS since fetch doesn't hold open connection resources that need manual closing
	}

	reset(): void {
		this.cid = this.rid = this.rcid = null;
		this.lastTitle = null;
	}

	resume(cid: string, rid: string | null = null, rcid: string | null = null): void {
		this.cid = cid;
		this.rid = rid;
		this.rcid = rcid;
	}

	get conversation(): [string | null, string | null, string | null] {
		return [this.cid, this.rid, this.rcid];
	}

	async bootstrap(): Promise<string> {
		await this.init();
		try {
			const headers = {
				...this.getBaseHeaders(),
				Referer: GEMINI_HOST + "/",
			};
			const resp = await fetch(GEMINI_APP_URL, { headers });
			if (!resp.ok) {
				throw new GeminiWebError(
					`GET /app returned HTTP ${resp.status} (cookies rejected or redirected to sign-in)`
				);
			}
			const html = await resp.text();
			const atMatch = html.match(SNLM0E_RE);
			if (!atMatch) {
				throw new GeminiWebError(
					"SNlM0e token not found — not signed in. The Google session " +
						"cookies are missing or stale; re-import them."
				);
			}
			this.at = atMatch[1];
			const blMatch = html.match(CFB2H_RE);
			this.bl = blMatch ? blMatch[1] : DEFAULT_BL;
			return this.at;
		} catch (err) {
			if (err instanceof GeminiWebError) throw err;
			throw new GeminiWebError(`GET ${GEMINI_APP_URL} failed: ${err}`);
		}
	}

	async generate(
		prompt: string,
		opts: { keepContext?: boolean; model?: string } = {},
	): Promise<string> {
		const keepContext = opts.keepContext ?? true;
		if (this.at === null) {
			await this.bootstrap();
		}

		const context = keepContext ? [this.cid, this.rid, this.rcid] : null;
		const inner = JSON.stringify([[prompt], null, context]);
		const fReq = JSON.stringify([null, inner]);

		const params = new URLSearchParams({
			bl: this.bl ?? DEFAULT_BL,
			_reqid: String(Math.floor(10000 + Math.random() * 90000)),
			rt: "c",
		});

		const form = new URLSearchParams();
		form.append("at", this.at!);
		form.append("f.req", fReq);

		const headers: Record<string, string> = {
			...this.getBaseHeaders(),
			"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
			Origin: GEMINI_HOST,
			Referer: GEMINI_APP_URL,
			"X-Same-Domain": "1",
			"x-goog-ext-525001261-jspb": getModelHeader(opts.model ?? this.model, this.clientUuid),
		};

		let url = `${GEMINI_HOST}${STREAM_GENERATE_PATH}?${params.toString()}`;
		let resp = await fetch(url, {
			method: "POST",
			headers,
			body: form.toString(),
		});

		if (!resp.ok) {
			if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
				await this.bootstrap();
				headers.Cookie = this.getCookieHeader(GEMINI_COOKIE_HOST);
				form.set("at", this.at!);
				resp = await fetch(url, {
					method: "POST",
					headers,
					body: form.toString(),
				});
			}
			if (!resp.ok) {
				throw new GeminiWebError(`StreamGenerate returned HTTP ${resp.status}`);
			}
		}

		const text = await resp.text();
		const parsed = parseStream(text);
		if (keepContext) {
			[this.cid, this.rid, this.rcid] = parsed.conversation;
		}
		if (parsed.lastTitle) {
			this.lastTitle = parsed.lastTitle;
		}
		return parsed.text;
	}

	async listConversations(): Promise<ConversationHistory[]> {
		if (this.at === null) {
			await this.bootstrap();
		}

		const innerArgs = JSON.stringify([20, null, [0, null, 1]]);
		const fReq = [[["MaZiqc", innerArgs, null, "generic"]]];

		const params = new URLSearchParams({
			bl: this.bl ?? DEFAULT_BL,
			_reqid: String(Math.floor(100000 + Math.random() * 900000)),
			rt: "c",
		});

		const form = new URLSearchParams();
		form.append("at", this.at!);
		form.append("f.req", JSON.stringify(fReq));

		const headers: Record<string, string> = {
			...this.getBaseHeaders(),
			"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
			Origin: GEMINI_HOST,
			Referer: GEMINI_APP_URL,
			"X-Same-Domain": "1",
		};

		let url = `${GEMINI_HOST}/_/BardChatUi/data/batchexecute?${params.toString()}`;
		let resp = await fetch(url, {
			method: "POST",
			headers,
			body: form.toString(),
		});

		if (!resp.ok) {
			if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
				await this.bootstrap();
				headers.Cookie = this.getCookieHeader(GEMINI_COOKIE_HOST);
				form.set("at", this.at!);
				resp = await fetch(url, {
					method: "POST",
					headers,
					body: form.toString(),
				});
			}
			if (!resp.ok) {
				throw new GeminiWebError(`batchexecute returned HTTP ${resp.status}`);
			}
		}

		const raw = await resp.text();
		return parseConversations(raw);
	}

	async deleteConversation(cid: string): Promise<void> {
		if (this.at === null) {
			await this.bootstrap();
		}

		const innerArgs = JSON.stringify([cid, 1]);
		const fReq = [[["GzXR5e", innerArgs, null, "generic"]]];

		const params = new URLSearchParams({
			bl: this.bl ?? DEFAULT_BL,
			_reqid: String(Math.floor(100000 + Math.random() * 900000)),
			rt: "c",
		});

		const form = new URLSearchParams();
		form.append("at", this.at!);
		form.append("f.req", JSON.stringify(fReq));

		const headers: Record<string, string> = {
			...this.getBaseHeaders(),
			"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
			Origin: GEMINI_HOST,
			Referer: GEMINI_APP_URL,
			"X-Same-Domain": "1",
		};

		let url = `${GEMINI_HOST}/_/BardChatUi/data/batchexecute?${params.toString()}`;
		let resp = await fetch(url, {
			method: "POST",
			headers,
			body: form.toString(),
		});

		if (!resp.ok) {
			if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
				await this.bootstrap();
				headers.Cookie = this.getCookieHeader(GEMINI_COOKIE_HOST);
				form.set("at", this.at!);
				resp = await fetch(url, {
					method: "POST",
					headers,
					body: form.toString(),
				});
			}
			if (!resp.ok) {
				throw new GeminiWebError(`batchexecute returned HTTP ${resp.status}`);
			}
		}
	}
}

function getModelHeader(modelId: string, clientUuid: string): string {
	const tokens: Record<string, [string, number]> = {
		"flash-lite": ["1d44b34bcaa1c04d", 6],
		"flashlite": ["1d44b34bcaa1c04d", 6],
		"flash": ["56fdd199312815e2", 1],
		"pro": ["e6fa609c3fa255c0", 3],
	};
	let key = modelId.toLowerCase().trim();
	if (!tokens[key]) {
		key = "flash";
	}
	const [token, variant] = tokens[key];
	const arr = [
		1,
		null,
		null,
		null,
		token,
		null,
		null,
		0,
		[4, 5, 6, 8],
		null,
		null,
		3,
		null,
		null,
		variant,
		1,
		clientUuid,
	];
	return JSON.stringify(arr);
}

function parseStream(raw: string): {
	text: string;
	conversation: [string | null, string | null, string | null];
	lastTitle?: string;
} {
	let main: any = null;
	let lastTitle: string | undefined;

	const lines = raw.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line.startsWith("[[")) {
			continue;
		}
		let chunk: any;
		try {
			chunk = JSON.parse(line);
		} catch {
			continue;
		}
		if (!Array.isArray(chunk)) {
			continue;
		}
		for (const item of chunk) {
			if (
				Array.isArray(item) &&
				item.length >= 3 &&
				item[0] === "wrb.fr" &&
				typeof item[2] === "string" &&
				item[2]
			) {
				let body: any;
				try {
					body = JSON.parse(item[2]);
				} catch {
					continue;
				}
				if (body && typeof body === "object" && !Array.isArray(body)) {
					if (
						body["11"] &&
						Array.isArray(body["11"]) &&
						body["11"].length > 0 &&
						typeof body["11"][0] === "string"
					) {
						lastTitle = body["11"][0];
					}
				} else if (Array.isArray(body)) {
					if (body.length > 4 && body[4]) {
						main = body;
					} else if (main === null) {
						main = body;
					}
				}
			}
		}
	}

	if (main === null) {
		throw new GeminiWebError(
			"no 'wrb.fr' payload with content in StreamGenerate response"
		);
	}

	const extracted = extractReply(main);
	return {
		text: extracted.text,
		conversation: extracted.conversation,
		lastTitle,
	};
}

function extractReply(body: any[]): {
	text: string;
	conversation: [string | null, string | null, string | null];
} {
	let cid: string | null = null;
	let rid: string | null = null;
	let rcid: string | null = null;

	if (body.length > 1 && Array.isArray(body[1])) {
		const meta = body[1];
		cid = meta.length > 0 ? meta[0] : null;
		rid = meta.length > 1 ? meta[1] : null;
	}

	let text = "";
	if (body.length > 4 && Array.isArray(body[4]) && body[4].length > 0) {
		const candidate = body[4][0];
		if (Array.isArray(candidate)) {
			if (candidate.length > 0 && typeof candidate[0] === "string") {
				rcid = candidate[0];
			}
			if (
				candidate.length > 1 &&
				Array.isArray(candidate[1]) &&
				candidate[1].length > 0 &&
				typeof candidate[1][0] === "string"
			) {
				text = candidate[1][0];
			}
		}
	}
	return {
		text,
		conversation: [cid, rid, rcid],
	};
}

function parseConversations(raw: string): ConversationHistory[] {
	const conversations: ConversationHistory[] = [];

	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line.startsWith("[[")) {
			continue;
		}
		let chunk: any;
		try {
			chunk = JSON.parse(line);
		} catch {
			continue;
		}
		if (!Array.isArray(chunk)) {
			continue;
		}
		for (const item of chunk) {
			if (
				Array.isArray(item) &&
				item.length >= 3 &&
				item[0] === "wrb.fr" &&
				item[1] === "MaZiqc" &&
				typeof item[2] === "string" &&
				item[2]
			) {
				let body: any;
				try {
					body = JSON.parse(item[2]);
				} catch {
					continue;
				}

				const found = collectConversationsFromJson(body);
				for (const [cid, title, ts] of found) {
					if (!conversations.some((c) => c.cid === cid)) {
						conversations.push({
							cid,
							title,
							updated_at: ts,
						});
					}
				}
			}
		}
	}

	return conversations;
}

function collectConversationsFromJson(val: any): Array<[string, string, number]> {
	const res: Array<[string, string, number]> = [];
	if (Array.isArray(val)) {
		if (
			val.length >= 3 &&
			typeof val[0] === "string" &&
			val[0].startsWith("c_") &&
			typeof val[1] === "string" &&
			typeof val[2] === "number"
		) {
			res.push([val[0], val[1], val[2]]);
		}
		for (const item of val) {
			res.push(...collectConversationsFromJson(item));
		}
	} else if (val && typeof val === "object") {
		for (const v of Object.values(val)) {
			res.push(...collectConversationsFromJson(v));
		}
	}
	return res;
}
