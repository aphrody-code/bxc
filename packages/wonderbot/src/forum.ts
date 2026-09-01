/**
 * Le forum comme catalogue : un fil par saison, tenu à jour par le bot.
 *
 * ── UN FIL PAR SAISON, PAS PAR ÉPISODE ─────────────────────────────────────
 * Un fil par épisode ferait douze cents fils : illisible, et Discord archive
 * les plus anciens. Une saison tient dans UN message — mais pas dans un seul
 * embed : 51 épisodes en deux langues dépassent les 4 096 caractères d'une
 * description. D'où le format compact de `listerSaison` (pas de titre, liens
 * `youtu.be`) et son découpage en pages, sous le plafond de 6 000 caractères
 * que Discord applique à l'ensemble des embeds d'un message.
 *
 * ── LE FIL EST RETROUVÉ PAR IDENTIFIANT ────────────────────────────────────
 * La correspondance saison → fil est mémorisée dans le cache. Chercher par nom
 * casserait au premier renommage, et l'expérience de ce serveur est qu'un nom
 * se fait renommer. Un fil disparu (supprimé à la main) est simplement recréé.
 *
 * ── LE BOT MODIFIE, IL NE REPUBLIE PAS ─────────────────────────────────────
 * Le message d'ouverture d'un fil de forum porte l'identifiant du fil : il se
 * modifie. Republier à chaque rafraîchissement noierait les discussions des
 * membres sous des listes identiques.
 */

import type { Catalogue } from "./catalogue.ts";
import { ICONES, fiche, listerSaison, repartitionLangues, type Embed } from "./ui/index.ts";
import type { Marque } from "./ui/theme.ts";

/** Clé de métadonnée portant la table saison → identifiant de fil. */
export const CLE_FILS = "wonderbot:forum-fils";

/** Ce que la synchronisation attend de Discord — remplacé par une doublure en test. */
export interface PasserelleForum {
	/** Identifiants des fils encore présents dans le salon forum. */
	filsExistants(): Promise<string[]>;
	/** Crée un fil et rend son identifiant. */
	creerFil(nom: string, embeds: Embed[], etiquettes: string[]): Promise<string>;
	/** Réécrit le message d'ouverture d'un fil. */
	majFil(filId: string, nom: string, embeds: Embed[], etiquettes: string[]): Promise<void>;
}

/** Ce que la synchronisation attend du support de persistance. */
export interface StockageFils {
	lireMeta(cle: string): string | null;
	ecrireMeta(cle: string, valeur: string): void;
}

export interface OptionsForum {
	catalogue: Catalogue;
	passerelle: PasserelleForum;
	stockage: StockageFils;
	marque: Marque;
	/** Étiquettes du forum, par libellé en minuscules → identifiant. */
	etiquettes?: Readonly<Record<string, string>>;
}

export interface ResultatSynchronisation {
	crees: number[];
	majs: number[];
	/** Saisons dont le fil avait disparu et qui ont été recréées. */
	recrees: number[];
}

/** Table saison → fil, tolérante à une valeur abîmée. */
export function analyserTableFils(brut: string | null): Map<number, string> {
	if (!brut || brut.trim() === "") return new Map();
	try {
		const valeur: unknown = JSON.parse(brut);
		if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return new Map();
		return new Map(
			Object.entries(valeur as Record<string, unknown>)
				.filter((entree): entree is [string, string] => typeof entree[1] === "string")
				.map(([saison, fil]) => [Number(saison), fil] as const)
				.filter(([saison]) => Number.isFinite(saison))
		);
	} catch {
		// Table illisible : on repart d'une table vide. Les fils orphelins seront
		// recréés, ce qui vaut mieux que de refuser de synchroniser.
		return new Map();
	}
}

/** Nom du fil d'une saison. Stable : c'est lui qui se lit dans la liste du forum. */
export function nomFilSaison(saison: number, episodes: number): string {
	return `Saison ${saison} — ${episodes} épisode(s)`;
}

/**
 * Étiquettes à poser sur le fil d'une saison : les langues réellement présentes.
 * Une étiquette absente du forum est simplement ignorée — le fil vaut mieux
 * sans étiquette que pas de fil du tout.
 */
export function etiquettesDeSaison(
  langues: Readonly<Record<string, number>>,
  disponibles: Readonly<Record<string, string>>
): string[] {
	const voulues: string[] = [];
	if ((langues.vf ?? 0) > 0) voulues.push("vf");
	if ((langues.vostfr ?? 0) > 0) voulues.push("vostfr");
	return voulues.map((nom) => disponibles[nom]).filter((id): id is string => typeof id === "string");
}

export class SynchronisationForum {
	private readonly options: OptionsForum;

	constructor(options: OptionsForum) {
		this.options = options;
	}

	private table(): Map<number, string> {
		return analyserTableFils(this.options.stockage.lireMeta(CLE_FILS));
	}

	private enregistrer(table: Map<number, string>): void {
		this.options.stockage.ecrireMeta(
			CLE_FILS,
			JSON.stringify(Object.fromEntries([...table].map(([s, f]) => [String(s), f])))
		);
	}

	/**
	 * Embeds d'ouverture d'une saison : la liste, puis les compteurs.
	 *
	 * Plusieurs embeds, parce qu'une saison complète ne tient pas dans une seule
	 * description. Les compteurs vont sur le DERNIER : posés sur le premier, ils
	 * sépareraient la liste en deux moitiés sans rapport visuel.
	 */
	construireEmbeds(saison: number): {
		embeds: Embed[];
		episodes: number;
		langues: Record<string, number>;
	} {
		const episodes = this.options.catalogue.saison(saison, undefined, 10_000);
		const liste = listerSaison(episodes);

		const langues: Record<string, number> = {};
		for (const episode of episodes) langues[episode.language] = (langues[episode.language] ?? 0) + 1;

		const pages = liste.pages.length > 0 ? liste.pages : ["Aucun épisode référencé pour cette saison."];

		const embeds = pages.map((page, index) => {
			const f = fiche({
				titre: index === 0 ? `${ICONES.saison} Saison ${saison}` : `Saison ${saison} (suite)`,
				marque: this.options.marque,
			}).description(page);

			if (index === pages.length - 1) {
				f.champ("Épisodes", String(liste.episodes), { enLigne: true });
				f.champ("Versions", repartitionLangues(langues), { enLigne: true });
			}
			return f.finir(index === pages.length - 1 && liste.omis > 0 ? `${liste.omis} non listé(s)` : undefined);
		});

		return { embeds, episodes: liste.episodes, langues };
	}

	/**
	 * Met le forum en accord avec le catalogue : un fil par saison, créé s'il
	 * manque, réécrit s'il existe. Ne supprime jamais un fil — les membres y
	 * discutent, et une saison qui disparaît du catalogue est plus souvent un
	 * scraping raté qu'une saison retirée.
	 */
	async synchroniser(): Promise<ResultatSynchronisation> {
		const saisons = this.options.catalogue.saisonsDisponibles();
		if (saisons.length === 0) {
			return { crees: [], majs: [], recrees: [] };
		}

		const table = this.table();
		const vivants = new Set(await this.options.passerelle.filsExistants());
		const etiquettes = this.options.etiquettes ?? {};
		const resultat: ResultatSynchronisation = { crees: [], majs: [], recrees: [] };

		for (const saison of saisons) {
			const { embeds, episodes, langues } = this.construireEmbeds(saison);
			const nom = nomFilSaison(saison, episodes);
			const tags = etiquettesDeSaison(langues, etiquettes);
			const connu = table.get(saison);

			if (connu && vivants.has(connu)) {
				await this.options.passerelle.majFil(connu, nom, embeds, tags);
				resultat.majs.push(saison);
				continue;
			}

			const filId = await this.options.passerelle.creerFil(nom, embeds, tags);
			table.set(saison, filId);
			(connu ? resultat.recrees : resultat.crees).push(saison);
		}

		this.enregistrer(table);
		return resultat;
	}
}
