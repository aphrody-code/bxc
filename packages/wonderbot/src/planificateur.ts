/**
 * Planificateur — le « cron » interne de Wonderbot.
 *
 * Un seul travail périodique : rafraîchir le catalogue, puis passer les
 * nouveautés à l'annonceur. Pas de démon séparé, pas de socket, pas de table
 * d'exécutions : le bot est le seul consommateur du catalogue, le faire piloter
 * par un service tiers n'ajouterait que des pannes possibles.
 *
 * ── LES MINUTEURS SONT INJECTABLES ─────────────────────────────────────────
 * `planifier`, `annuler` et `now` sont des paramètres : une horloge factice
 * suffit à vérifier la période, le rattrapage d'erreur et l'arrêt propre, sans
 * jamais attendre six heures.
 */

import type { ResultatRafraichissement } from "./catalogue.ts";

export type IdentifiantMinuteur = ReturnType<typeof setTimeout>;

export interface OptionsPlanificateur {
	/** Période entre deux rafraîchissements, en millisecondes. */
	intervalleMs: number;
	/** Le travail lui-même. */
	rafraichir: () => Promise<ResultatRafraichissement>;
	/** Appelé après chaque rafraîchissement réussi. */
	surSucces?: (resultat: ResultatRafraichissement) => void | Promise<void>;
	/** Appelé quand un passage échoue — le suivant est planifié quand même. */
	surErreur?: (erreur: unknown) => void;
	/**
	 * Lancer un premier passage au démarrage. `false` par défaut : au démarrage
	 * d'un service, le catalogue vient souvent d'être rafraîchi, et rescraper
	 * sept sources à chaque redémarrage coûte cher pour rien.
	 */
	immediat?: boolean;
	planifier?: (rappel: () => void, delaiMs: number) => IdentifiantMinuteur;
	annuler?: (identifiant: IdentifiantMinuteur) => void;
	now?: () => number;
}

export interface EtatPlanificateur {
	actif: boolean;
	/** Nombre de passages terminés, réussis ou non. */
	passages: number;
	echecs: number;
	/** Horodatage du dernier passage réussi, 0 si aucun. */
	dernierSucces: number;
	/** Message de la dernière erreur, `null` si le dernier passage a réussi. */
	derniereErreur: string | null;
}

export class Planificateur {
	private readonly options: Required<Omit<OptionsPlanificateur, "surSucces" | "surErreur">> &
		Pick<OptionsPlanificateur, "surSucces" | "surErreur">;

	private minuteur: IdentifiantMinuteur | null = null;
	private enCours = false;
	private etat: EtatPlanificateur = {
		actif: false,
		passages: 0,
		echecs: 0,
		dernierSucces: 0,
		derniereErreur: null,
	};

	constructor(options: OptionsPlanificateur) {
		this.options = {
			immediat: false,
			planifier: (rappel, delai) => setTimeout(rappel, delai),
			annuler: (identifiant) => clearTimeout(identifiant),
			now: Date.now,
			...options,
		};
	}

	instantane(): EtatPlanificateur {
		return { ...this.etat };
	}

	/** Démarre la boucle. Sans effet si elle tourne déjà. */
	demarrer(): void {
		if (this.etat.actif) return;
		this.etat.actif = true;
		if (this.options.immediat) {
			void this.executer();
		} else {
			this.armer();
		}
	}

	/**
	 * Arrête la boucle. Un passage déjà lancé va à son terme — l'interrompre
	 * laisserait le catalogue à moitié réécrit.
	 */
	arreter(): void {
		this.etat.actif = false;
		if (this.minuteur !== null) {
			this.options.annuler(this.minuteur);
			this.minuteur = null;
		}
	}

	/** Déclenche un passage hors calendrier, sans perturber la période. */
	async declencher(): Promise<ResultatRafraichissement> {
		return this.options.rafraichir();
	}

	private armer(): void {
		if (!this.etat.actif) return;
		this.minuteur = this.options.planifier(() => {
			void this.executer();
		}, this.options.intervalleMs);
	}

	private async executer(): Promise<void> {
		// Un passage qui déborde sur le suivant écrirait la même base deux fois :
		// on saute le tour plutôt que de les superposer.
		if (this.enCours) {
			this.armer();
			return;
		}

		this.enCours = true;
		try {
			const resultat = await this.options.rafraichir();
			this.etat.passages++;
			this.etat.dernierSucces = this.options.now();
			this.etat.derniereErreur = null;
			await this.options.surSucces?.(resultat);
		} catch (err) {
			this.etat.passages++;
			this.etat.echecs++;
			this.etat.derniereErreur = err instanceof Error ? err.message : String(err);
			this.options.surErreur?.(err);
		} finally {
			this.enCours = false;
			// Toujours réarmer, y compris après un échec : une panne réseau
			// passagère ne doit pas arrêter définitivement les rafraîchissements.
			this.armer();
		}
	}
}
