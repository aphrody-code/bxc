// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { CL_DIMS } from "./descriptor.ts";
import { FrameIndex, defaultIndexPath } from "./store.ts";

function vector(fill: number): Uint8Array {
	return new Uint8Array(CL_DIMS).fill(fill);
}

function freshIndex(): FrameIndex {
	return new FrameIndex(":memory:");
}

describe("index local", () => {
	test("réenregistrer une source met à jour au lieu de dupliquer", () => {
		const index = freshIndex();
		const first = index.upsertMedia({ source: "ep1.mkv", title: "Épisode 1", fps: 1 });
		const second = index.upsertMedia({
			source: "ep1.mkv",
			title: "Épisode 1 (VF)",
			season: 2,
			episode: 7,
			fps: 4,
		});
		expect(second).toBe(first);
		expect(index.listMedia()).toHaveLength(1);
		expect(index.getMedia(first)?.title).toBe("Épisode 1 (VF)");
		expect(index.getMedia(first)?.season).toBe(2);
		expect(index.getMedia(first)?.fps).toBe(4);
		index.close();
	});

	test("insérer des trames met à jour le compteur du média", () => {
		const index = freshIndex();
		const id = index.upsertMedia({ source: "ep.mkv", title: "ep", fps: 2 });
		const written = index.insertFrames(id, [
			{ tMs: 0, vector: vector(1) },
			{ tMs: 500, vector: vector(2) },
		]);
		expect(written).toBe(2);
		expect(index.getMedia(id)?.frameCount).toBe(2);
		expect(index.stats()).toMatchObject({ media: 1, frames: 2 });
		index.close();
	});

	test("réindexer le même horodatage remplace la trame au lieu d'échouer", () => {
		const index = freshIndex();
		const id = index.upsertMedia({ source: "ep.mkv", title: "ep", fps: 1 });
		index.insertFrames(id, [{ tMs: 0, vector: vector(1) }]);
		index.insertFrames(id, [{ tMs: 0, vector: vector(9) }]);
		const frames = [...index.iterateFrames(id)];
		expect(frames).toHaveLength(1);
		expect(frames[0].vector[0]).toBe(9);
		index.close();
	});

	test("refuse un vecteur de taille inattendue", () => {
		const index = freshIndex();
		const id = index.upsertMedia({ source: "ep.mkv", title: "ep", fps: 1 });
		expect(() => index.insertFrames(id, [{ tMs: 0, vector: new Uint8Array(8) }])).toThrow(
			/33 octets/,
		);
		index.close();
	});

	test("le balayage pagine sans sauter ni répéter de trame", () => {
		const index = freshIndex();
		const a = index.upsertMedia({ source: "a.mkv", title: "a", fps: 1 });
		const b = index.upsertMedia({ source: "b.mkv", title: "b", fps: 1 });
		index.insertFrames(
			a,
			Array.from({ length: 7 }, (_, i) => ({ tMs: i * 1000, vector: vector(i) })),
		);
		index.insertFrames(
			b,
			Array.from({ length: 5 }, (_, i) => ({ tMs: i * 1000, vector: vector(i) })),
		);
		// Une page plus petite que le contenu force plusieurs allers-retours.
		const all = [...index.iterateFrames(undefined, 3)];
		expect(all).toHaveLength(12);
		expect(new Set(all.map((f) => `${f.mediaId}:${f.tMs}`)).size).toBe(12);
		expect([...index.iterateFrames(b, 2)]).toHaveLength(5);
		index.close();
	});

	test("framesBetween borne la plage, bornes incluses", () => {
		const index = freshIndex();
		const id = index.upsertMedia({ source: "ep.mkv", title: "ep", fps: 1 });
		index.insertFrames(
			id,
			Array.from({ length: 5 }, (_, i) => ({ tMs: i * 1000, vector: vector(i) })),
		);
		expect(index.framesBetween(id, 1000, 3000).map((f) => f.tMs)).toEqual([1000, 2000, 3000]);
		index.close();
	});

	test("vider ou supprimer un média emporte ses trames", () => {
		const index = freshIndex();
		const id = index.upsertMedia({ source: "ep.mkv", title: "ep", fps: 1 });
		index.insertFrames(id, [{ tMs: 0, vector: vector(1) }]);
		index.clearFrames(id);
		expect(index.stats().frames).toBe(0);
		expect(index.getMedia(id)?.frameCount).toBe(0);
		index.insertFrames(id, [{ tMs: 0, vector: vector(1) }]);
		index.deleteMedia(id);
		expect(index.stats()).toMatchObject({ media: 0, frames: 0 });
		index.close();
	});

	test("le chemin par défaut suit BXC_FRAMES_DB", () => {
		const previous = process.env.BXC_FRAMES_DB;
		process.env.BXC_FRAMES_DB = "/tmp/bxc-frames-test.db";
		// resolve() normalise le séparateur : la comparaison doit être portable.
		expect(defaultIndexPath()).toBe(resolve("/tmp/bxc-frames-test.db"));
		if (previous === undefined) delete process.env.BXC_FRAMES_DB;
		else process.env.BXC_FRAMES_DB = previous;
		expect(defaultIndexPath()).toMatch(/frames\.db$/);
	});
});
