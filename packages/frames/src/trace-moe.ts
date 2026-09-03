// SPDX-License-Identifier: Apache-2.0
/**
 * Client de l'API publique trace.moe — le recours, pas le chemin par défaut.
 *
 * Deux raisons de ne l'appeler qu'en second : le quota (100 recherches par
 * 24 h sans clé, une seule requête à la fois) et la confidentialité — envoyer
 * une image à un tiers, c'est lui confier ce qu'on cherche. D'où
 * {@link TraceMoeClient.searchByVector}, le chemin privilégié ici : le
 * descripteur est calculé en local et seuls 33 entiers partent sur le réseau,
 * jamais l'image. C'est aussi le plus rapide, puisque le serveur n'a plus à
 * télécharger ni décoder quoi que ce soit.
 *
 * Les trois freins de l'API (quota glissant, concurrence 1, file d'attente
 * priorisée) se traduisent ici par une file interne stricte et une taxonomie
 * d'erreurs : ce qui se retente ({@link TraceMoeError.retryable}) et ce qui ne
 * se retente pas. Horloge, attente et aléa sont injectables — les budgets se
 * testent sans attendre.
 */

import { encodeVector } from "./descriptor.ts";

/** Point d'entrée public de l'API. */
export const TRACE_MOE_ENDPOINT = "https://api.trace.moe";

/** Nature d'un échec, pour décider quoi faire ensuite. */
export type TraceMoeErrorKind =
	| "quota"
	| "concurrency"
	| "rate-limit"
	| "busy"
	| "bad-request"
	| "too-large"
	| "server"
	| "network";

/** Échec d'un appel à l'API, classé. */
export class TraceMoeError extends Error {
	constructor(
		public readonly kind: TraceMoeErrorKind,
		message: string,
		public readonly status?: number,
		public readonly retryAfterMs?: number,
	) {
		super(message);
		this.name = "TraceMoeError";
	}

	/** Vrai si réessayer plus tard a une chance d'aboutir. */
	get retryable(): boolean {
		return (
			this.kind === "concurrency" ||
			this.kind === "rate-limit" ||
			this.kind === "busy" ||
			this.kind === "server" ||
			this.kind === "network"
		);
	}
}

/** Fiche AniList renvoyée quand `anilistInfo` est demandé. */
export interface AnilistInfo {
	id: number;
	idMal?: number | null;
	title?: { native?: string | null; romaji?: string | null; english?: string | null };
	synonyms?: string[];
	isAdult?: boolean;
}

/** Une correspondance renvoyée par l'API. */
export interface TraceMoeResult {
	anilist: number | AnilistInfo;
	filename: string;
	episode: number | number[] | null;
	episode_start?: number | null;
	episode_end?: number | null;
	duration?: number;
	from: number;
	at: number;
	to: number;
	similarity: number;
	video: string;
	image: string;
}

/** Réponse de `/search`. */
export interface TraceMoeResponse {
	frameCount: number;
	error: string;
	quota: number;
	quotaUsed: number;
	result: TraceMoeResult[];
}

/** Réponse de `/me` : l'état du quota. */
export interface TraceMoeQuota {
	id: string;
	priority: number;
	concurrency: number;
	quota: number;
	quotaUsed: number;
}

/** Points d'injection et réglages du client. */
export interface TraceMoeOptions {
	endpoint?: string;
	/** Clé d'API, envoyée en en-tête `x-trace-key` (jamais en query string). */
	apiKey?: string;
	fetch?: typeof fetch;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
	/** Nombre de reprises après une erreur retentable (défaut : 3). */
	maxRetries?: number;
	/** Attente minimale entre deux requêtes, en ms (défaut : 250). */
	minDelayMs?: number;
	/** Base du délai exponentiel de reprise, en ms (défaut : 1000). */
	backoffBaseMs?: number;
}

/** Options communes aux recherches. */
export interface TraceMoeSearchOptions {
	/** Joindre la fiche AniList (plus lent côté serveur). */
	anilistInfo?: boolean;
	/** Restreindre la recherche à un anime. */
	anilistID?: number;
	/** Rogner les bandes noires — sans effet sur une recherche par vecteur. */
	cutBorders?: boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export class TraceMoeClient {
	private readonly endpoint: string;
	private readonly apiKey?: string;
	private readonly fetchFn: typeof fetch;
	private readonly now: () => number;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly random: () => number;
	private readonly maxRetries: number;
	private readonly minDelayMs: number;
	private readonly backoffBaseMs: number;

	/** File d'attente : une requête à la fois, c'est la limite du service. */
	private tail: Promise<unknown> = Promise.resolve();
	/** −∞ tant qu'aucun appel n'est parti : la première requête ne s'espace de rien. */
	private lastCallAt = Number.NEGATIVE_INFINITY;
	private lastQuota: TraceMoeQuota | null = null;

	constructor(opts: TraceMoeOptions = {}) {
		this.endpoint = (opts.endpoint ?? TRACE_MOE_ENDPOINT).replace(/\/$/, "");
		this.apiKey = opts.apiKey ?? process.env.TRACE_MOE_KEY ?? undefined;
		this.fetchFn = opts.fetch ?? globalThis.fetch;
		this.now = opts.now ?? Date.now;
		this.sleep = opts.sleep ?? defaultSleep;
		this.random = opts.random ?? Math.random;
		this.maxRetries = opts.maxRetries ?? 3;
		this.minDelayMs = opts.minDelayMs ?? 250;
		this.backoffBaseMs = opts.backoffBaseMs ?? 1000;
	}

	/** Dernier état de quota observé, `null` tant qu'aucun appel n'a abouti. */
	get quota(): TraceMoeQuota | null {
		return this.lastQuota;
	}

	/**
	 * Recherche par vecteur : rien d'autre que le descripteur ne quitte la
	 * machine. Accepte un vecteur, son encodage base64, ou un lot (10 au plus,
	 * chacun décompté du quota).
	 */
	searchByVector(
		vector: number[] | string | Array<number[] | string>,
		opts: TraceMoeSearchOptions = {},
	): Promise<TraceMoeResponse> {
		const encode = (v: number[] | string): string =>
			typeof v === "string" ? v : encodeVector(v);
		const payload = Array.isArray(vector) && Array.isArray(vector[0])
			? (vector as Array<number[] | string>).map(encode)
			: Array.isArray(vector) && typeof vector[0] === "string"
				? (vector as string[])
				: encode(vector as number[] | string);
		return this.request<TraceMoeResponse>("/search", {
			method: "POST",
			query: this.searchQuery(opts),
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ vector: payload }),
		});
	}

	/** Recherche en téléversant l'image (25 Mo au plus). */
	searchByImage(
		bytes: Uint8Array | ArrayBuffer,
		opts: TraceMoeSearchOptions & { contentType?: string } = {},
	): Promise<TraceMoeResponse> {
		const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		return this.request<TraceMoeResponse>("/search", {
			method: "POST",
			query: this.searchQuery(opts),
			headers: { "Content-Type": opts.contentType ?? "image/jpeg" },
			body,
		});
	}

	/** Recherche en confiant au serveur le soin de télécharger l'image. */
	searchByUrl(url: string, opts: TraceMoeSearchOptions = {}): Promise<TraceMoeResponse> {
		return this.request<TraceMoeResponse>("/search", {
			method: "GET",
			query: { ...this.searchQuery(opts), url },
		});
	}

	/** État du quota du compte (ou de l'adresse IP, sans clé). */
	async me(): Promise<TraceMoeQuota> {
		const quota = await this.request<TraceMoeQuota>("/me", { method: "GET" });
		this.lastQuota = quota;
		return quota;
	}

	/** État de l'index public, ou la liste des fichiers indexés d'un anime. */
	status(anilistID?: number): Promise<unknown> {
		return this.request("/status", {
			method: "GET",
			query: anilistID ? { id: String(anilistID) } : {},
		});
	}

	/** Recherche d'un anime par titre dans l'index public. */
	anilist(query: string): Promise<unknown> {
		return this.request("/anilist", { method: "GET", query: { q: query } });
	}

	private searchQuery(opts: TraceMoeSearchOptions): Record<string, string> {
		const query: Record<string, string> = {};
		if (opts.anilistInfo) query.anilistInfo = "";
		if (opts.cutBorders) query.cutBorders = "";
		if (opts.anilistID !== undefined) query.anilistID = String(opts.anilistID);
		return query;
	}

	/**
	 * Sérialise les appels, espace les requêtes et reprend ce qui mérite de
	 * l'être. Le 402 est ambigu côté serveur — quota épuisé *ou* requête
	 * concurrente ; on tranche avec le quota connu, sinon on retente une fois.
	 */
	private request<T>(
		path: string,
		init: {
			method: string;
			query?: Record<string, string>;
			headers?: Record<string, string>;
			body?: Uint8Array | string;
		},
	): Promise<T> {
		const run = async (): Promise<T> => {
			for (let attempt = 0; ; attempt++) {
				const wait = this.minDelayMs - (this.now() - this.lastCallAt);
				if (wait > 0) await this.sleep(wait);
				try {
					return await this.call<T>(path, init);
				} catch (err) {
					const error =
						err instanceof TraceMoeError
							? err
							: new TraceMoeError("network", String((err as Error)?.message ?? err));
					if (!error.retryable || attempt >= this.maxRetries) throw error;
					const backoff =
						error.retryAfterMs ??
						this.backoffBaseMs * 2 ** attempt * (1 + this.random());
					await this.sleep(Math.round(backoff));
				}
			}
		};
		const queued = this.tail.then(run, run);
		// La file ne doit pas se rompre sur un échec : on la fait avancer quoi qu'il arrive.
		this.tail = queued.then(
			() => undefined,
			() => undefined,
		);
		return queued;
	}

	private async call<T>(
		path: string,
		init: {
			method: string;
			query?: Record<string, string>;
			headers?: Record<string, string>;
			body?: Uint8Array | string;
		},
	): Promise<T> {
		const url = new URL(this.endpoint + path);
		for (const [key, value] of Object.entries(init.query ?? {})) {
			url.searchParams.set(key, value);
		}
		const headers: Record<string, string> = { ...init.headers };
		if (this.apiKey) headers["x-trace-key"] = this.apiKey;

		let response: Response;
		try {
			response = await this.fetchFn(url.toString(), {
				method: init.method,
				headers,
				body: init.body as BodyInit | undefined,
			});
		} catch (err) {
			throw new TraceMoeError("network", `appel ${path} impossible : ${String(err)}`);
		} finally {
			this.lastCallAt = this.now();
		}

		const text = await response.text();
		const payload = safeJson(text);
		if (!response.ok) {
			throw this.classify(response, payload, text);
		}
		if (payload && typeof payload === "object" && "quota" in payload) {
			const body = payload as { quota: number; quotaUsed: number };
			this.lastQuota = {
				...(this.lastQuota ?? { id: "", priority: 0, concurrency: 1 }),
				quota: body.quota,
				quotaUsed: body.quotaUsed,
			};
		}
		return payload as T;
	}

	private classify(response: Response, payload: unknown, text: string): TraceMoeError {
		const message =
			(payload as { error?: string } | null)?.error?.trim() || text.trim() || response.statusText;
		const retryAfter = Number(response.headers.get("retry-after"));
		const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
		switch (response.status) {
			case 400:
				return new TraceMoeError("bad-request", message, 400);
			case 402: {
				// Quota épuisé, ou deuxième requête envoyée trop tôt : le service
				// répond pareil dans les deux cas. Le quota connu tranche.
				const exhausted = this.lastQuota
					? this.lastQuota.quotaUsed >= this.lastQuota.quota
					: /quota/i.test(message);
				return exhausted
					? new TraceMoeError("quota", message || "quota épuisé", 402)
					: new TraceMoeError("concurrency", message || "requête concurrente refusée", 402);
			}
			case 403:
				return new TraceMoeError("bad-request", message || "clé refusée", 403);
			case 413:
				return new TraceMoeError("too-large", message || "image trop lourde (25 Mo max)", 413);
			case 429:
				return new TraceMoeError("rate-limit", message, 429, retryAfterMs);
			case 503:
				return new TraceMoeError("busy", message || "file d'attente pleine", 503, retryAfterMs);
			default:
				return response.status >= 500
					? new TraceMoeError("server", message, response.status, retryAfterMs)
					: new TraceMoeError("bad-request", message, response.status);
		}
	}
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
