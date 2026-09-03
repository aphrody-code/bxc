// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { CL_DIMS, encodeVector } from "./descriptor.ts";
import { TraceMoeClient, TraceMoeError } from "./trace-moe.ts";

const VECTOR = Array.from({ length: CL_DIMS }, (_, i) => i % 32);

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

/** Faux `fetch` qui enregistre les appels et rejoue des réponses scriptées. */
function stubFetch(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
	const calls: Call[] = [];
	const fetchFn = (async (url: string, init: RequestInit = {}) => {
		calls.push({
			url: String(url),
			method: init.method ?? "GET",
			headers: (init.headers ?? {}) as Record<string, string>,
			body: typeof init.body === "string" ? init.body : undefined,
		});
		const next = responses.shift() ?? { body: {} };
		return new Response(JSON.stringify(next.body), {
			status: next.status ?? 200,
			headers: next.headers,
		});
	}) as unknown as typeof fetch;
	return { fetchFn, calls };
}

const OK = {
	body: { frameCount: 1, error: "", quota: 100, quotaUsed: 1, result: [] },
};

/** Client dont l'attente est instantanée mais mesurée. */
function client(
	responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>,
	opts: { apiKey?: string; maxRetries?: number } = {},
) {
	const { fetchFn, calls } = stubFetch(responses);
	const waits: number[] = [];
	let clock = 0;
	const traceMoe = new TraceMoeClient({
		fetch: fetchFn,
		now: () => clock,
		sleep: async (ms) => {
			waits.push(ms);
			clock += ms;
		},
		random: () => 0,
		backoffBaseMs: 1000,
		minDelayMs: 0,
		...opts,
	});
	return { traceMoe, calls, waits };
}

describe("recherche par vecteur", () => {
	test("n'envoie que le descripteur, jamais d'image", async () => {
		const { traceMoe, calls } = client([OK]);
		await traceMoe.searchByVector(VECTOR);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ vector: encodeVector(VECTOR) });
		expect(calls[0].body).not.toContain("image");
	});

	test("accepte un lot de vecteurs", async () => {
		const { traceMoe, calls } = client([OK]);
		await traceMoe.searchByVector([VECTOR, encodeVector(VECTOR)]);
		expect(JSON.parse(calls[0].body ?? "{}").vector).toEqual([
			encodeVector(VECTOR),
			encodeVector(VECTOR),
		]);
	});

	test("porte les options dans la query string", async () => {
		const { traceMoe, calls } = client([OK]);
		await traceMoe.searchByVector(VECTOR, { anilistInfo: true, anilistID: 5231 });
		expect(calls[0].url).toContain("anilistInfo=");
		expect(calls[0].url).toContain("anilistID=5231");
	});

	test("la clé d'API voyage en en-tête, pas dans l'URL", async () => {
		const { traceMoe, calls } = client([OK], { apiKey: "secret" });
		await traceMoe.me();
		expect(calls[0].headers["x-trace-key"]).toBe("secret");
		expect(calls[0].url).not.toContain("secret");
	});

	test("mémorise le quota vu dans la réponse", async () => {
		const { traceMoe } = client([
			{ body: { frameCount: 1, error: "", quota: 100, quotaUsed: 42, result: [] } },
		]);
		await traceMoe.searchByVector(VECTOR);
		expect(traceMoe.quota).toMatchObject({ quota: 100, quotaUsed: 42 });
	});
});

describe("taxonomie des erreurs", () => {
	test("402 avec quota épuisé n'est pas retentable", async () => {
		const { traceMoe, calls } = client([
			{ body: { id: "ip", priority: 0, concurrency: 1, quota: 100, quotaUsed: 100 } },
			{ status: 402, body: { error: "quota exceeded" } },
		]);
		await traceMoe.me();
		const err = (await traceMoe.searchByVector(VECTOR).catch((e) => e)) as TraceMoeError;
		expect(err).toBeInstanceOf(TraceMoeError);
		expect(err.kind).toBe("quota");
		expect(err.retryable).toBe(false);
		expect(calls).toHaveLength(2); // aucune reprise
	});

	test("402 avec du quota restant est lu comme une requête concurrente et retenté", async () => {
		const { traceMoe, calls, waits } = client([
			{ body: { id: "ip", priority: 0, concurrency: 1, quota: 100, quotaUsed: 3 } },
			{ status: 402, body: { error: "concurrency limit" } },
			OK,
		]);
		await traceMoe.me();
		await traceMoe.searchByVector(VECTOR);
		expect(calls).toHaveLength(3);
		expect(waits).toEqual([1000]);
	});

	test("429 attend la durée demandée par le serveur", async () => {
		const { traceMoe, waits } = client([
			{ status: 429, body: { error: "slow down" }, headers: { "retry-after": "7" } },
			OK,
		]);
		await traceMoe.searchByVector(VECTOR);
		expect(waits).toEqual([7000]);
	});

	test("503 est retenté avec un délai qui double", async () => {
		const { traceMoe, waits } = client([
			{ status: 503, body: { error: "busy" } },
			{ status: 503, body: { error: "busy" } },
			OK,
		]);
		await traceMoe.searchByVector(VECTOR);
		expect(waits).toEqual([1000, 2000]);
	});

	test("abandonne après le nombre de reprises convenu", async () => {
		const { traceMoe, calls } = client(
			[
				{ status: 503, body: { error: "busy" } },
				{ status: 503, body: { error: "busy" } },
			],
			{ maxRetries: 1 },
		);
		const err = (await traceMoe.searchByVector(VECTOR).catch((e) => e)) as TraceMoeError;
		expect(err.kind).toBe("busy");
		expect(calls).toHaveLength(2);
	});

	test("classe le 400, le 403 et le 413 sans les retenter", async () => {
		for (const [status, kind] of [
			[400, "bad-request"],
			[403, "bad-request"],
			[413, "too-large"],
		] as const) {
			const { traceMoe, calls } = client([{ status, body: { error: "non" } }]);
			const err = (await traceMoe.searchByVector(VECTOR).catch((e) => e)) as TraceMoeError;
			expect(err.kind).toBe(kind);
			expect(err.retryable).toBe(false);
			expect(calls).toHaveLength(1);
		}
	});
});

describe("file d'attente", () => {
	test("sérialise les appels : la concurrence du service est de 1", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const fetchFn = (async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight--;
			return new Response(JSON.stringify(OK.body));
		}) as unknown as typeof fetch;
		const traceMoe = new TraceMoeClient({ fetch: fetchFn, minDelayMs: 0 });
		await Promise.all([
			traceMoe.searchByVector(VECTOR),
			traceMoe.searchByVector(VECTOR),
			traceMoe.searchByVector(VECTOR),
		]);
		expect(maxInFlight).toBe(1);
	});

	test("un échec ne bloque pas les appels suivants", async () => {
		const { traceMoe } = client([
			{ status: 400, body: { error: "non" } },
			OK,
		]);
		await expect(traceMoe.searchByVector(VECTOR)).rejects.toThrow();
		await expect(traceMoe.searchByVector(VECTOR)).resolves.toMatchObject({ error: "" });
	});

	test("respecte le délai minimal entre deux requêtes", async () => {
		const { fetchFn } = stubFetch([OK, OK]);
		const waits: number[] = [];
		let clock = 0;
		const traceMoe = new TraceMoeClient({
			fetch: fetchFn,
			now: () => clock,
			sleep: async (ms) => {
				waits.push(ms);
				clock += ms;
			},
			minDelayMs: 500,
		});
		await traceMoe.searchByVector(VECTOR);
		await traceMoe.searchByVector(VECTOR);
		expect(waits).toEqual([500]);
	});
});
