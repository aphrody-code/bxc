// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { CL_DIMS, similarityFromDistance } from "./descriptor.ts";
import { SCENE_TOLERANCE, formatTimecode, searchIndex } from "./search.ts";
import { FrameIndex } from "./store.ts";

/** Vecteur dont seul le coefficient 5 varie : distance = |a − b|. */
function vector(level: number): Uint8Array {
	const v = new Uint8Array(CL_DIMS);
	v[5] = level;
	return v;
}

const query = vector(0);

function indexWith(
	frames: Array<{ tMs: number; level: number }>,
	fps = 1,
): { index: FrameIndex; id: number } {
	const index = new FrameIndex(":memory:");
	const id = index.upsertMedia({
		source: "ep.mkv",
		title: "Épisode",
		season: 1,
		episode: 3,
		durationMs: 60_000,
		fps,
	});
	index.insertFrames(
		id,
		frames.map((f) => ({ tMs: f.tMs, vector: vector(f.level) })),
	);
	return { index, id };
}

describe("recherche locale", () => {
	test("rend la trame la plus proche et son score", () => {
		const { index } = indexWith([
			{ tMs: 0, level: 40 },
			{ tMs: 1000, level: 3 },
			{ tMs: 2000, level: 50 },
		]);
		const [best] = searchIndex(index, query);
		expect(best.atMs).toBe(1000);
		expect(best.distance).toBe(3);
		expect(best.similarity).toBeCloseTo(similarityFromDistance(3), 10);
		expect(best).toMatchObject({ title: "Épisode", season: 1, episode: 3 });
		index.close();
	});

	test("classe les médias par distance et respecte la limite", () => {
		const index = new FrameIndex(":memory:");
		const near = index.upsertMedia({ source: "a.mkv", title: "proche", fps: 1 });
		const far = index.upsertMedia({ source: "b.mkv", title: "loin", fps: 1 });
		const other = index.upsertMedia({ source: "c.mkv", title: "autre", fps: 1 });
		index.insertFrames(near, [{ tMs: 0, vector: vector(2) }]);
		index.insertFrames(far, [{ tMs: 0, vector: vector(30) }]);
		index.insertFrames(other, [{ tMs: 0, vector: vector(60) }]);
		const results = searchIndex(index, query, { limit: 2 });
		expect(results.map((r) => r.title)).toEqual(["proche", "loin"]);
		index.close();
	});

	test("un seul média est retenu par recherche, sa meilleure trame", () => {
		const { index } = indexWith([
			{ tMs: 0, level: 5 },
			{ tMs: 1000, level: 1 },
		]);
		expect(searchIndex(index, query)).toHaveLength(1);
		index.close();
	});

	test("la scène s'étend aux trames voisines qui se ressemblent", () => {
		const { index } = indexWith([
			{ tMs: 0, level: 60 },
			{ tMs: 1000, level: SCENE_TOLERANCE + 5 },
			{ tMs: 2000, level: 2 },
			{ tMs: 3000, level: SCENE_TOLERANCE - 5 },
			{ tMs: 4000, level: 60 },
		]);
		const [best] = searchIndex(index, query);
		expect(best.atMs).toBe(2000);
		expect(best.fromMs).toBe(2000);
		expect(best.toMs).toBe(3000);
		index.close();
	});

	test("un trou dans l'échantillonnage coupe la scène", () => {
		const { index } = indexWith([
			{ tMs: 0, level: 1 },
			{ tMs: 1000, level: 0 },
			// 5 s plus loin : même image, mais ce n'est plus le même plan.
			{ tMs: 6000, level: 0 },
		]);
		const [best] = searchIndex(index, query);
		expect(best.fromMs).toBe(0);
		expect(best.toMs).toBe(1000);
		index.close();
	});

	test("filtre sur le score minimal", () => {
		const { index } = indexWith([{ tMs: 0, level: 50 }]);
		expect(searchIndex(index, query, { minSimilarity: 0.9 })).toHaveLength(0);
		expect(searchIndex(index, query, { minSimilarity: 0.4 })).toHaveLength(1);
		index.close();
	});

	test("restreint la recherche à un média", () => {
		const index = new FrameIndex(":memory:");
		const a = index.upsertMedia({ source: "a.mkv", title: "a", fps: 1 });
		const b = index.upsertMedia({ source: "b.mkv", title: "b", fps: 1 });
		index.insertFrames(a, [{ tMs: 0, vector: vector(2) }]);
		index.insertFrames(b, [{ tMs: 0, vector: vector(40) }]);
		const results = searchIndex(index, query, { mediaId: b });
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe("b");
		index.close();
	});

	test("un index vide ne rend rien", () => {
		const index = new FrameIndex(":memory:");
		expect(searchIndex(index, query)).toEqual([]);
		index.close();
	});
});

describe("affichage des horodatages", () => {
	test("omet l'heure quand elle est nulle", () => {
		expect(formatTimecode(0)).toBe("0:00.000");
		expect(formatTimecode(63_400)).toBe("1:03.400");
		expect(formatTimecode(3_723_456)).toBe("1:02:03.456");
	});
});
