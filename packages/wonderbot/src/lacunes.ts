/**
 * Détection des épisodes manquants, et réparation bornée.
 *
 * ── UN TROU N'EST PAS UNE ABSENCE ──────────────────────────────────────────
 * Une saison qui va de E01 à E51 sans E07 a un TROU : l'épisode existe, le
 * scraping l'a raté. Une saison qui s'arrête à E12 n'a pas de trou — elle est
 * en cours de diffusion. On ne cherche donc les manquants qu'ENTRE le premier
 * et le dernier épisode connus, jamais au-delà.
 *
 * ── POURQUOI LA RÉPARATION EST BORNÉE ──────────────────────────────────────
 * Un « réessaie tant que c'est incomplet » martèle les sources à l'infini pour
 * un épisode qui, la plupart du temps, n'a jamais été mis en ligne. La
 * réparation retente donc un nombre FIXE de fois, espacées, puis classe le trou
 * comme *confirmé* et cesse d'y revenir — jusqu'à ce que le catalogue change.
 * Un trou confirmé n'est pas un échec : c'est une information, affichée dans le
 * fil de la saison.
 */

import type { EpisodeCatalogue } from "./ui/format.ts";

/** Clé de métadonnée portant les trous déjà confirmés. */
export const CLE_LACUNES = "wonderbot:lacunes";

export interface LacuneSaison {
	saison: number;
	/** Numéros absents entre le premier et le dernier épisode connus. */
	manquants: number[];
	/** Premier et dernier épisodes réellement présents. */
	borne: { debut: number; fin: number };
}

export interface StockageLacunes {
	lireMeta(cle: string): string | null;
	ecrireMeta(cle: string, valeur: string): void;
}

/**
 * Trous d'une saison : les numéros absents entre le premier et le dernier
 * épisode connus. Rend `null` quand la saison est complète, vide, ou n'a qu'un
 * seul épisode identifié (aucun intervalle où chercher).
 */
export function lacunesDeSaison(
	saison: number,
	episodes: readonly EpisodeCatalogue[]
): LacuneSaison | null {
	const numeros = [...new Set(episodes.map((e) => e.episode).filter((n): n is number => n !== null))];
	if (numeros.length < 2) return null;

	const debut = Math.min(...numeros);
	const fin = Math.max(...numeros);
	const presents = new Set(numeros);

	const manquants: number[] = [];
	for (let n = debut; n <= fin; n++) {
		if (!presents.has(n)) manquants.push(n);
	}

	return manquants.length === 0 ? null : { saison, manquants, borne: { debut, fin } };
}

/** Trous de tout le catalogue, saison par saison. */
export function detecterLacunes(
	parSaison: ReadonlyMap<number, readonly EpisodeCatalogue[]>
): LacuneSaison[] {
	return [...parSaison.entries()]
		.map(([saison, episodes]) => lacunesDeSaison(saison, episodes))
		.filter((l): l is LacuneSaison => l !== null)
		.sort((a, b) => a.saison - b.saison);
}

/** Empreinte stable d'un trou : `3:7` = saison 3, épisode 7. */
export function empreinte(saison: number, episode: number): string {
	return `${saison}:${episode}`;
}

/** Toutes les empreintes d'une liste de lacunes. */
export function empreintes(lacunes: readonly LacuneSaison[]): Set<string> {
	const jeu = new Set<string>();
	for (const lacune of lacunes) {
		for (const numero of lacune.manquants) jeu.add(empreinte(lacune.saison, numero));
	}
	return jeu;
}

/** `S03 · E07, E12` — pour le journal et le fil de la saison. */
export function decrireLacune(lacune: LacuneSaison): string {
	const liste = lacune.manquants.map((n) => `E${String(n).padStart(2, "0")}`);
	const apercu = liste.slice(0, 12).join(", ");
	const reste = liste.length - 12;
	return `S${String(lacune.saison).padStart(2, "0")} · ${apercu}${reste > 0 ? ` (+${reste})` : ""}`;
}

export interface DecisionReparation {
	/** Trous jamais vus : ils justifient une nouvelle tentative. */
	nouveaux: string[];
	/** Trous déjà retentés le nombre de fois prévu : on n'y revient plus. */
	confirmes: string[];
	/** Faut-il relancer un rafraîchissement ? */
	retenter: boolean;
}

export interface OptionsReparateur {
	stockage: StockageLacunes;
	/** Tentatives supplémentaires par trou avant de le confirmer. */
	tentativesMax?: number;
}

/** État persistant d'un trou : nombre de tentatives déjà consommées. */
type Registre = Record<string, number>;

function analyserRegistre(brut: string | null): Registre {
	if (!brut || brut.trim() === "") return {};
	try {
		const valeur: unknown = JSON.parse(brut);
		if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return {};
		return Object.fromEntries(
			Object.entries(valeur as Record<string, unknown>).filter(
				(e): e is [string, number] => typeof e[1] === "number"
			)
		);
	} catch {
		return {};
	}
}

export class Reparateur {
	private readonly stockage: StockageLacunes;
	private readonly tentativesMax: number;

	constructor(options: OptionsReparateur) {
		this.stockage = options.stockage;
		// Deux tentatives : la première rattrape un scraping partiel (le cas
		// courant), la seconde une source momentanément indisponible. Au-delà,
		// l'épisode n'existe pas — le redemander n'y changera rien.
		this.tentativesMax = options.tentativesMax ?? 2;
	}

	private registre(): Registre {
		return analyserRegistre(this.stockage.lireMeta(CLE_LACUNES));
	}

	/**
	 * Décide s'il faut relancer un rafraîchissement, et met à jour le compteur
	 * de tentatives.
	 *
	 * Un trou qui DISPARAÎT sort du registre : s'il revient plus tard, il aura
	 * de nouveau droit à ses tentatives. C'est voulu — une source qui republie
	 * son catalogue mérite qu'on retente.
	 */
	evaluer(lacunes: readonly LacuneSaison[]): DecisionReparation {
		const actuels = empreintes(lacunes);
		const precedent = this.registre();
		const suivant: Registre = {};

		const nouveaux: string[] = [];
		const confirmes: string[] = [];

		for (const cle of actuels) {
			const tentatives = precedent[cle] ?? 0;
			if (tentatives < this.tentativesMax) {
				suivant[cle] = tentatives + 1;
				nouveaux.push(cle);
			} else {
				suivant[cle] = tentatives;
				confirmes.push(cle);
			}
		}

		this.stockage.ecrireMeta(CLE_LACUNES, JSON.stringify(suivant));

		return { nouveaux: nouveaux.sort(), confirmes: confirmes.sort(), retenter: nouveaux.length > 0 };
	}

	/** Trous confirmés, pour l'affichage. */
	confirmes(): Set<string> {
		const registre = this.registre();
		return new Set(
			Object.entries(registre)
				.filter(([, tentatives]) => tentatives >= this.tentativesMax)
				.map(([cle]) => cle)
		);
	}

	/** Oublie tout : le prochain passage re-tentera chaque trou. */
	reinitialiser(): void {
		this.stockage.ecrireMeta(CLE_LACUNES, "");
	}
}
