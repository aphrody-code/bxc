/**
 * Annonce des nouveaux épisodes.
 *
 * ── LE PREMIER PASSAGE N'ANNONCE RIEN ──────────────────────────────────────
 * Un bot fraîchement installé voit 1 200 épisodes « nouveaux » : tous. Les
 * annoncer déverserait douze cents messages dans un salon pour dire ce que
 * personne n'attendait. Le premier passage AMORCE donc le journal sans rien
 * publier — exactement comme un curseur créé à `now()` : la première annonce
 * portera sur un épisode paru APRÈS l'installation.
 *
 * ── LE JOURNAL EST BORNÉ PAR LE CATALOGUE ──────────────────────────────────
 * On mémorise les identifiants déjà vus, pas une date : une source peut publier
 * un épisode ancien (rattrapage d'une saison, remise en ligne), et un curseur
 * temporel le manquerait. La liste est élaguée à chaque passage sur ce que le
 * catalogue contient encore, elle ne grossit donc pas indéfiniment.
 */

import type { EpisodeCatalogue } from "./ui/format.ts";

/** Clé de métadonnée portant les identifiants déjà annoncés. */
export const CLE_JOURNAL = "wonderbot:annonces-vues";

/** Ce que le journal attend de son support de persistance. */
export interface StockageJournal {
	lireMeta(cle: string): string | null;
	ecrireMeta(cle: string, valeur: string): void;
}

export interface DecisionAnnonce {
	/** Épisodes à publier, dans l'ordre d'affichage. */
	aAnnoncer: EpisodeCatalogue[];
	/** Vrai quand ce passage n'a fait qu'amorcer le journal. */
	amorcage: boolean;
	/** Nombre d'épisodes neufs laissés de côté par le plafond. */
	omis: number;
}

/**
 * Épisodes présents mais jamais annoncés. Fonction PURE : c'est elle qui porte
 * la règle, le reste n'est que persistance.
 */
export function diffNouveaux(
	vus: ReadonlySet<string>,
	catalogue: readonly EpisodeCatalogue[]
): EpisodeCatalogue[] {
	return catalogue.filter((episode) => !vus.has(episode.videoId));
}

/** Lit une liste d'identifiants sérialisée, en tolérant une valeur abîmée. */
export function analyserJournal(brut: string | null): Set<string> | null {
	if (brut === null || brut.trim() === "") return null;
	try {
		const valeur: unknown = JSON.parse(brut);
		if (!Array.isArray(valeur)) return null;
		return new Set(valeur.filter((entree): entree is string => typeof entree === "string"));
	} catch {
		// Journal illisible : on le traite comme absent. Le passage suivant
		// ré-amorce sans rien publier, ce qui vaut mieux que tout republier.
		return null;
	}
}

export class JournalAnnonces {
	constructor(
		private readonly stockage: StockageJournal,
		private readonly cle: string = CLE_JOURNAL
	) {}

	/** Identifiants déjà annoncés, ou `null` si le journal n'existe pas encore. */
	vus(): Set<string> | null {
		return analyserJournal(this.stockage.lireMeta(this.cle));
	}

	/**
	 * Décide quoi annoncer et met le journal à jour dans la foulée.
	 *
	 * La mise à jour est faite MÊME quand le plafond écarte des épisodes : sans
	 * cela, les mêmes surplus reviendraient à chaque passage sans jamais être
	 * publiés. Le plafond protège d'une inondation, il ne crée pas une file
	 * d'attente.
	 */
	traiter(catalogue: readonly EpisodeCatalogue[], plafond: number): DecisionAnnonce {
		const vus = this.vus();
		const identifiants = catalogue.map((episode) => episode.videoId);

		if (vus === null) {
			this.enregistrer(identifiants);
			return { aAnnoncer: [], amorcage: true, omis: 0 };
		}

		const nouveaux = diffNouveaux(vus, catalogue);
		this.enregistrer(identifiants);

		// Les plus récents d'abord : si le plafond coupe, mieux vaut annoncer le
		// dernier épisode paru que le premier d'un rattrapage de saison.
		const ordonnes = [...nouveaux].reverse();
		return {
			aAnnoncer: ordonnes.slice(0, plafond),
			amorcage: false,
			omis: Math.max(0, ordonnes.length - plafond),
		};
	}

	/** Remplace le journal par la liste donnée (élaguée au catalogue courant). */
	enregistrer(identifiants: readonly string[]): void {
		this.stockage.ecrireMeta(this.cle, JSON.stringify([...new Set(identifiants)]));
	}

	/** Efface le journal : le passage suivant ré-amorce sans rien publier. */
	reinitialiser(): void {
		this.stockage.ecrireMeta(this.cle, "");
	}
}
