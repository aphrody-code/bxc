// SPDX-License-Identifier: Apache-2.0
/**
 * L'index local : une base SQLite de vecteurs, un par trame échantillonnée.
 *
 * Un vecteur ColorLayout tient sur 33 octets, donc un épisode de 24 minutes
 * échantillonné à 1 image/s pèse une cinquantaine de kilo-octets — les 412
 * épisodes du catalogue IETV tiennent dans une vingtaine de méga-octets. À
 * cette taille, la recherche par force brute est plus rapide que n'importe
 * quel index approché, et surtout elle reste exacte : pas de base vectorielle,
 * pas de service à faire tourner.
 *
 * La table `frames` est `WITHOUT ROWID` : sa clé primaire (média, horodatage)
 * est déjà l'ordre de lecture du balayage, autant s'en servir comme stockage.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { CL_DIMS } from "./descriptor.ts";

/** Ce qu'on sait d'un média avant de l'indexer. */
export interface MediaMeta {
	/** Chemin ou URL du média — identifiant unique dans l'index. */
	source: string;
	title: string;
	season?: number | null;
	episode?: number | null;
	/** Durée du média en millisecondes (0 si inconnue). */
	durationMs?: number;
	/** Cadence d'échantillonnage retenue, en trames par seconde. */
	fps: number;
}

/** Une ligne de la table `media`. */
export interface MediaRow extends MediaMeta {
	id: number;
	durationMs: number;
	frameCount: number;
	indexedAt: number;
}

/** Une trame indexée. */
export interface FrameRow {
	mediaId: number;
	tMs: number;
	vector: Uint8Array;
}

/** Compteurs de l'index. */
export interface IndexStats {
	media: number;
	frames: number;
	/** Durée cumulée des médias indexés, en millisecondes. */
	durationMs: number;
}

/** Chemin par défaut de l'index (surchargé par `BXC_FRAMES_DB`). */
export function defaultIndexPath(): string {
	const fromEnv = process.env.BXC_FRAMES_DB;
	if (fromEnv) return resolve(fromEnv);
	return resolve(homedir(), ".cache/bxc/frames.db");
}

export class FrameIndex {
	private readonly db: Database;
	public readonly path: string;

	constructor(path: string = defaultIndexPath()) {
		this.path = path === ":memory:" ? path : resolve(path.replace(/^~(?=\/|$)/, homedir()));
		if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true });
		this.db = new Database(this.path, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS media (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source TEXT UNIQUE NOT NULL,
				title TEXT NOT NULL,
				season INTEGER,
				episode INTEGER,
				durationMs INTEGER NOT NULL DEFAULT 0,
				fps REAL NOT NULL,
				frameCount INTEGER NOT NULL DEFAULT 0,
				indexedAt INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS frames (
				mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
				tMs INTEGER NOT NULL,
				cl BLOB NOT NULL,
				PRIMARY KEY (mediaId, tMs)
			) WITHOUT ROWID;

			CREATE INDEX IF NOT EXISTS idx_media_episode ON media(season, episode);
		`);
		this.db.exec("PRAGMA foreign_keys = ON");
	}

	/** Crée ou met à jour l'entrée d'un média et rend son identifiant. */
	upsertMedia(meta: MediaMeta, now: number = Date.now()): number {
		const row = this.db
			.query<{ id: number }, [string]>("SELECT id FROM media WHERE source = ?")
			.get(meta.source);
		if (row) {
			this.db.run(
				"UPDATE media SET title = ?, season = ?, episode = ?, durationMs = ?, fps = ?, indexedAt = ? WHERE id = ?",
				[
					meta.title,
					meta.season ?? null,
					meta.episode ?? null,
					meta.durationMs ?? 0,
					meta.fps,
					now,
					row.id,
				],
			);
			return row.id;
		}
		this.db.run(
			"INSERT INTO media (source, title, season, episode, durationMs, fps, frameCount, indexedAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
			[
				meta.source,
				meta.title,
				meta.season ?? null,
				meta.episode ?? null,
				meta.durationMs ?? 0,
				meta.fps,
				now,
			],
		);
		return Number(
			this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id ?? 0,
		);
	}

	/**
	 * Insère un lot de trames dans une seule transaction et rend le nombre de
	 * lignes écrites. Réindexer un média écrase ses trames : l'opération est
	 * donc rejouable telle quelle après une interruption.
	 */
	insertFrames(mediaId: number, frames: Iterable<{ tMs: number; vector: Uint8Array }>): number {
		const stmt = this.db.prepare(
			"INSERT OR REPLACE INTO frames (mediaId, tMs, cl) VALUES (?, ?, ?)",
		);
		let written = 0;
		const tx = this.db.transaction((batch: Iterable<{ tMs: number; vector: Uint8Array }>) => {
			for (const frame of batch) {
				if (frame.vector.length !== CL_DIMS) {
					throw new Error(`vecteur de ${CL_DIMS} octets attendu, reçu ${frame.vector.length}`);
				}
				stmt.run(mediaId, frame.tMs, frame.vector);
				written++;
			}
		});
		tx(frames);
		this.db.run(
			"UPDATE media SET frameCount = (SELECT COUNT(*) FROM frames WHERE mediaId = ?) WHERE id = ?",
			[mediaId, mediaId],
		);
		return written;
	}

	/** Efface les trames d'un média sans toucher à son entrée. */
	clearFrames(mediaId: number): void {
		this.db.run("DELETE FROM frames WHERE mediaId = ?", [mediaId]);
		this.db.run("UPDATE media SET frameCount = 0 WHERE id = ?", [mediaId]);
	}

	/** Supprime un média et ses trames. */
	deleteMedia(mediaId: number): void {
		this.db.run("DELETE FROM frames WHERE mediaId = ?", [mediaId]);
		this.db.run("DELETE FROM media WHERE id = ?", [mediaId]);
	}

	/** Tous les médias indexés, du plus récent au plus ancien. */
	listMedia(): MediaRow[] {
		return this.db
			.query<MediaRow, []>("SELECT * FROM media ORDER BY season, episode, id")
			.all();
	}

	/** Le média d'identifiant donné, ou `null`. */
	getMedia(mediaId: number): MediaRow | null {
		return (
			this.db.query<MediaRow, [number]>("SELECT * FROM media WHERE id = ?").get(mediaId) ?? null
		);
	}

	/** Le média d'une source donnée, ou `null`. */
	findMedia(source: string): MediaRow | null {
		return (
			this.db.query<MediaRow, [string]>("SELECT * FROM media WHERE source = ?").get(source) ?? null
		);
	}

	/**
	 * Balaie les trames dans l'ordre (média, horodatage).
	 *
	 * L'itération va par pages : une recherche ne charge jamais l'index entier
	 * en mémoire, même sur un catalogue de plusieurs centaines d'épisodes.
	 */
	*iterateFrames(mediaId?: number, pageSize = 50_000): Generator<FrameRow> {
		const stmt = mediaId
			? this.db.query<{ mediaId: number; tMs: number; cl: Uint8Array }, [number, number, number]>(
					"SELECT mediaId, tMs, cl FROM frames WHERE mediaId = ? AND tMs > ? ORDER BY tMs LIMIT ?",
				)
			: this.db.query<
					{ mediaId: number; tMs: number; cl: Uint8Array },
					[number, number, number]
				>(
					"SELECT mediaId, tMs, cl FROM frames WHERE (mediaId, tMs) > (?, ?) ORDER BY mediaId, tMs LIMIT ?",
				);
		let lastMedia = mediaId ?? 0;
		let lastT = -1;
		for (;;) {
			const rows = mediaId
				? stmt.all(mediaId, lastT, pageSize)
				: stmt.all(lastMedia, lastT, pageSize);
			if (!rows.length) return;
			for (const row of rows) {
				yield { mediaId: row.mediaId, tMs: row.tMs, vector: row.cl };
				lastMedia = row.mediaId;
				lastT = row.tMs;
			}
			if (rows.length < pageSize) return;
		}
	}

	/** Les trames d'un média sur une plage de temps, bornes incluses. */
	framesBetween(mediaId: number, fromMs: number, toMs: number): FrameRow[] {
		return this.db
			.query<
				{ mediaId: number; tMs: number; cl: Uint8Array },
				[number, number, number]
			>("SELECT mediaId, tMs, cl FROM frames WHERE mediaId = ? AND tMs BETWEEN ? AND ? ORDER BY tMs")
			.all(mediaId, fromMs, toMs)
			.map((row) => ({ mediaId: row.mediaId, tMs: row.tMs, vector: row.cl }));
	}

	/** Compteurs globaux de l'index. */
	stats(): IndexStats {
		const row = this.db
			.query<
				{ media: number; frames: number; durationMs: number },
				[]
			>("SELECT (SELECT COUNT(*) FROM media) AS media, (SELECT COUNT(*) FROM frames) AS frames, (SELECT COALESCE(SUM(durationMs), 0) FROM media) AS durationMs")
			.get();
		return row ?? { media: 0, frames: 0, durationMs: 0 };
	}

	close(): void {
		this.db.close();
	}
}
