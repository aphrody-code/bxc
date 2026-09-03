// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { CONFIDENCE_THRESHOLD, FrameSearch } from "./index.ts";
import { FrameIndex } from "./store.ts";
import { TraceMoeClient } from "./trace-moe.ts";
import type { SpawnedProcess } from "./ffmpeg.ts";

const SIZE = 4;
const FRAME_BYTES = SIZE * SIZE * 3;

/** Vignette unie : deux niveaux différents donnent deux descripteurs éloignés. */
function frame(level: number): Uint8Array {
	return new Uint8Array(FRAME_BYTES).fill(level);
}

function process(chunks: Uint8Array[], code = 0): SpawnedProcess {
	return {
		stdout: new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		stderr: null,
		exited: Promise.resolve(code),
	};
}

/** Aiguille ffprobe et ffmpeg vers des sorties scriptées. */
function fakeFfmpeg(frames: Uint8Array[], durationMs = 4000) {
	const commands: string[][] = [];
	return {
		commands,
		deps: {
			spawn: (cmd: readonly string[]) => {
				commands.push([...cmd]);
				if (cmd[0] === "ffprobe") {
					return process([
						new TextEncoder().encode(
							JSON.stringify({
								streams: [{ width: 640, height: 360, r_frame_rate: "24/1", codec_name: "h264" }],
								format: { duration: String(durationMs / 1000) },
							}),
						),
					]);
				}
				// `-frames:v` ne sort qu'une vignette : c'est le chemin « requête ».
				return process(cmd.includes("-frames:v") ? [frames[0]] : frames);
			},
		},
	};
}

function remoteStub(similarity: number) {
	return new TraceMoeClient({
		minDelayMs: 0,
		fetch: (async () =>
			new Response(
				JSON.stringify({
					frameCount: 1,
					error: "",
					quota: 100,
					quotaUsed: 7,
					result: [
						{
							anilist: { id: 5231, title: { romaji: "Inazuma Eleven" } },
							filename: "Inazuma Eleven - 01.mkv",
							episode: 1,
							from: 12.5,
							at: 12.75,
							to: 13,
							similarity,
							video: "https://api.trace.moe/video/xyz",
							image: "https://api.trace.moe/image/xyz",
						},
					],
				}),
			)) as unknown as typeof fetch,
	});
}

function engineWith(frames: Uint8Array[], remote?: TraceMoeClient) {
	const { deps, commands } = fakeFfmpeg(frames);
	const engine = new FrameSearch({
		index: new FrameIndex(":memory:"),
		ffmpeg: deps,
		size: SIZE,
		traceMoe: remote ?? remoteStub(0.99),
	});
	return { engine, commands };
}

describe("indexation", () => {
	test("écrit une trame par image échantillonnée, horodatée et étiquetée", async () => {
		const { engine } = engineWith([frame(10), frame(120), frame(240)]);
		const result = await engine.indexVideo("ep.mkv", {
			fps: 2,
			size: SIZE,
			title: "Inazuma Eleven S1E1",
			season: 1,
			episode: 1,
		});
		expect(result).toMatchObject({ frames: 3, durationMs: 4000, skipped: false });
		const media = engine.index.listMedia();
		expect(media).toHaveLength(1);
		expect(media[0]).toMatchObject({ title: "Inazuma Eleven S1E1", season: 1, episode: 1, fps: 2 });
		expect([...engine.index.iterateFrames()].map((f) => f.tMs)).toEqual([0, 500, 1000]);
		engine.close();
	});

	test("ne réindexe pas un média déjà couvert à la même cadence", async () => {
		const { engine, commands } = engineWith([frame(10), frame(120)]);
		await engine.indexVideo("ep.mkv", { fps: 1, size: SIZE });
		const before = commands.length;
		const second = await engine.indexVideo("ep.mkv", { fps: 1, size: SIZE });
		expect(second.skipped).toBe(true);
		expect(commands.length).toBe(before);
		const forced = await engine.indexVideo("ep.mkv", { fps: 1, size: SIZE, force: true });
		expect(forced.skipped).toBe(false);
		engine.close();
	});

	test("suit la progression", async () => {
		const { engine } = engineWith([frame(10), frame(20), frame(30), frame(40)]);
		const seen: number[] = [];
		await engine.indexVideo("ep.mkv", {
			fps: 1,
			size: SIZE,
			onProgress: (n) => seen.push(n),
			progressEvery: 2,
		});
		expect(seen).toEqual([2, 4]);
		engine.close();
	});
});

describe("recherche", () => {
	test("l'index local répond seul quand il est sûr de lui", async () => {
		const { engine } = engineWith([frame(200), frame(200)]);
		await engine.indexVideo("ep.mkv", { fps: 1, size: SIZE, title: "ep", season: 1, episode: 4 });
		const found = await engine.search("capture.jpg", { mode: "auto" });
		expect(found.origin).toBe("local");
		expect(found.matches[0]).toMatchObject({ title: "ep", episode: 4, similarity: 1 });
		engine.close();
	});

	test("bascule sur trace.moe quand le local ne reconnaît rien", async () => {
		// Vignettes indexées très éloignées de la requête décodée.
		const { deps } = fakeFfmpeg([frame(0)]);
		const engine = new FrameSearch({
			index: new FrameIndex(":memory:"),
			ffmpeg: deps,
			size: SIZE,
			traceMoe: remoteStub(0.99),
		});
		await engine.indexVideo("ep.mkv", { fps: 1, size: SIZE });
		// La requête est décodée par le même faux ffmpeg : on force l'écart en
		// vidant l'index, cas le plus défavorable.
		engine.index.clearFrames(engine.index.listMedia()[0].id);
		const found = await engine.search("capture.jpg", { mode: "auto" });
		expect(found.origin).toBe("remote");
		expect(found.quota).toEqual({ used: 7, total: 100 });
		expect(found.matches[0]).toMatchObject({
			title: "Inazuma Eleven",
			episode: 1,
			anilist: 5231,
			fromMs: 12_500,
			atMs: 12_750,
			toMs: 13_000,
		});
		expect(found.matches[0].preview?.image).toContain("api.trace.moe/image");
		engine.close();
	});

	test("le mode local n'appelle jamais le réseau, même bredouille", async () => {
		let called = false;
		const remote = new TraceMoeClient({
			fetch: (async () => {
				called = true;
				return new Response("{}");
			}) as unknown as typeof fetch,
		});
		const { engine } = engineWith([frame(0)], remote);
		const found = await engine.search("capture.jpg", { mode: "local" });
		expect(called).toBe(false);
		expect(found.origin).toBe("local");
		expect(found.matches).toEqual([]);
		engine.close();
	});

	test("le seuil de confiance vaut celui de trace.moe", () => {
		expect(CONFIDENCE_THRESHOLD).toBe(0.9);
	});
});
