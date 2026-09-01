/**
 * Configuration de Wonderbot — environnement lu UNE fois, en un seul endroit.
 *
 * ── CE MODULE EST PUR ──────────────────────────────────────────────────────
 * Aucune connexion, aucun accès disque, aucun effet de bord à l'import : il ne
 * fait que lire l'environnement qu'on lui PASSE et le valider. C'est ce qui
 * permet de le couvrir sans jeton ni base, et ce qui interdit qu'un simple
 * `import` déclenche une lecture d'environnement en douce.
 *
 * ── LES ERREURS DISENT QUOI FAIRE ──────────────────────────────────────────
 * Un jeton absent ne doit jamais ressortir en `undefined` propagé jusqu'à
 * `client.login()`, qui répond « An invalid token was provided » sans dire
 * quelle variable poser ni où. Deux valeurs présentes mais inutilisables sont
 * refusées explicitement parce qu'elles ont déjà été observées en production :
 * un secret scellé (`eyJ2Ijo…`) écrit à la place du texte clair, et une
 * référence shell non substituée (`$AUTRE`), Bun ne faisant pas l'expansion
 * dans un `.env`.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { MARQUE_PAR_DEFAUT, type Marque } from "./ui/theme.ts";

/** Vue lisible de l'environnement, passée en paramètre plutôt que lue ici. */
export type EnvLisible = Record<string, string | undefined>;

/** Où les slash commands sont publiées. */
export type PorteeCommandes = "guildes" | "globale";

export interface ConfigWonderbot {
	jeton: string;
	/** Identifiant de l'application, requis pour publier les commandes. */
	applicationId: string;
	/** Guildes visées quand `portee` vaut `"guildes"`. */
	guildes: readonly string[];
	/**
	 * `"guildes"` — publication immédiate, mais un serveur absent de la liste
	 * voit un bot en ligne et muet. `"globale"` — tout serveur qui invite le
	 * bot, au prix de quelques minutes de propagation.
	 *
	 * Les deux portées s'ADDITIONNENT côté Discord : passer à `"globale"` sans
	 * effacer les commandes de guilde affiche chaque commande en double.
	 */
	portee: PorteeCommandes;
	/** Base SQLite du catalogue IETV, partagée avec le planificateur. */
	cheminCache: string;
	/** Salon des annonces de nouveaux épisodes, `null` pour ne rien annoncer. */
	salonAnnonces: string | null;
	/**
	 * Salon FORUM tenant le catalogue — un fil par saison. `null` pour ne rien
	 * y publier.
	 */
	salonForum: string | null;
	/** Rôle mentionné après une annonce, `null` si aucun. */
	roleAnnonces: string | null;
	/** Rôles autorisés à déclencher un rafraîchissement. Vide = personne. */
	rolesStaff: readonly string[];
	/** Période de rafraîchissement du catalogue. */
	intervalleRafraichissementMs: number;
	/** Nombre maximal d'épisodes annoncés d'un coup (anti-inondation). */
	plafondAnnonces: number;
	/**
	 * Rafraîchir au démarrage quand le catalogue est vide ou plus vieux que
	 * l'intervalle. Évite qu'un redémarrage laisse un catalogue périmé pendant
	 * six heures — sans rescraper à chaque `systemctl restart`.
	 */
	rafraichirAuDemarrage: boolean;
	/**
	 * Retenter automatiquement quand un épisode manque au milieu d'une saison.
	 * `0` désactive la réparation.
	 */
	tentativesReparation: number;
	/** Délai avant une tentative de réparation. */
	delaiReparationMs: number;
	marque: Marque;
}

/** Variable portant le jeton, et ses replis historiques, dans l'ordre. */
const VARIABLES_JETON = ["WONDERBOT_DISCORD_TOKEN", "DISCORD_BOT_TOKEN", "DISCORD_TOKEN"] as const;
const VARIABLES_APPLICATION = [
	"WONDERBOT_APPLICATION_ID",
	"DISCORD_APPLICATION_ID",
	"DISCORD_CLIENT_ID",
] as const;
const VARIABLES_GUILDE = ["WONDERBOT_GUILD_ID", "DISCORD_GUILD_ID"] as const;

/** Un flocon Discord : 15 à 25 chiffres. */
const FLOCON = /^\d{15,25}$/;

/** Six heures — le catalogue IETV bouge au rythme des mises en ligne. */
const INTERVALLE_PAR_DEFAUT_MS = 6 * 60 * 60 * 1000;
/** Une minute : en dessous, on martèle YouTube pour rien. */
const INTERVALLE_MINIMUM_MS = 60_000;
const PLAFOND_ANNONCES_PAR_DEFAUT = 5;
/**
 * Deux tentatives : la première rattrape un scraping partiel (le cas courant),
 * la seconde une source momentanément indisponible. Au-delà, l'épisode n'existe
 * pas — le redemander n'y changera rien.
 */
const TENTATIVES_REPARATION_PAR_DEFAUT = 2;
/** 15 min : assez pour qu'une indisponibilité passagère se soit résorbée. */
const DELAI_REPARATION_PAR_DEFAUT_MS = 15 * 60 * 1000;

function lireBrut(env: EnvLisible, variables: readonly string[]): { variable: string; valeur: string } | null {
	for (const variable of variables) {
		const valeur = (env[variable] ?? "").trim();
		if (valeur !== "") return { variable, valeur };
	}
	return null;
}

/** Refuse les deux formes « présentes mais inutilisables » déjà rencontrées. */
function verifierSecret(variable: string, valeur: string): string {
	if (valeur.startsWith("eyJ2Ijo")) {
		throw new Error(
			`[wonderbot] ${variable} contient un secret SCELLÉ (« eyJ2Ijo… ») au lieu du jeton en clair. ` +
				"Rétablis la vraie valeur : le bot ne peut pas déchiffrer ce blob."
		);
	}
	if (valeur.startsWith("$")) {
		throw new Error(
			`[wonderbot] ${variable}="${valeur}" est une référence shell non substituée : Bun ne fait pas ` +
				"l'expansion des $VAR dans un .env. Écris la valeur littérale."
		);
	}
	return valeur;
}

/** Liste de flocons séparés par virgules/espaces, les entrées invalides tombent. */
export function lireFlocons(brut: string | undefined): string[] {
	return (brut ?? "")
		.split(/[,\s]+/)
		.map((part) => part.trim())
		.filter((part) => FLOCON.test(part));
}

/** Entier positif lu dans l'environnement, avec plancher et valeur de repli. */
export function lireEntier(
	brut: string | undefined,
	options: { defaut: number; minimum?: number }
): number {
	const valeur = Number.parseInt((brut ?? "").trim(), 10);
	if (!Number.isFinite(valeur) || valeur <= 0) return options.defaut;
	return options.minimum !== undefined ? Math.max(options.minimum, valeur) : valeur;
}

/**
 * Chemin du catalogue SQLite.
 *
 * Le défaut vit sous `~/.cache/ietv/` — le même que celui du scraper IETV, pour
 * que la CLI `bxc ietv` et le bot voient la MÊME base. En service durci
 * (`ProtectHome=read-only`), il faut soit ouvrir ce chemin en écriture via
 * `ReadWritePaths=`, soit pointer `IETV_CACHE_PATH` vers un répertoire d'état :
 * SQLite en mode WAL écrit des fichiers voisins (`-wal`, `-shm`), une base
 * « lue seulement » ne suffit pas.
 */
export function cheminCacheParDefaut(env: EnvLisible): string {
	const impose = (env.IETV_CACHE_PATH ?? env.WONDERBOT_CACHE_PATH ?? "").trim();
	if (impose !== "") return impose;
	return join(env.HOME || homedir(), ".cache", "ietv", "episodes.db");
}

/**
 * Lit et valide la configuration. Lève avec un message actionnable dès qu'une
 * valeur indispensable manque — mieux vaut un service qui refuse de démarrer en
 * disant pourquoi qu'un bot en ligne et muet.
 */
export function lireConfig(env: EnvLisible): ConfigWonderbot {
	const jeton = lireBrut(env, VARIABLES_JETON);
	if (!jeton) {
		throw new Error(
			"[wonderbot] Jeton Discord absent. Pose WONDERBOT_DISCORD_TOKEN dans .env " +
				"(Developer Portal → application Wonderbot → Bot → Reset Token). " +
				`Variables acceptées, dans l'ordre : ${VARIABLES_JETON.join(", ")}.`
		);
	}

	const application = lireBrut(env, VARIABLES_APPLICATION);
	if (!application) {
		throw new Error(
			"[wonderbot] Identifiant d'application absent. Pose WONDERBOT_APPLICATION_ID " +
				"(Developer Portal → General Information → Application ID) : il est indispensable " +
				"pour publier les slash commands."
		);
	}
	if (!FLOCON.test(application.valeur)) {
		throw new Error(
			`[wonderbot] ${application.variable}="${application.valeur}" n'est pas un identifiant Discord ` +
				"(15 à 25 chiffres). C'est l'Application ID, pas le nom de l'application."
		);
	}

	const guildes = lireFlocons(lireBrut(env, VARIABLES_GUILDE)?.valeur);
	const porteeDemandee = (env.WONDERBOT_COMMAND_SCOPE ?? "").trim().toLowerCase();
	if (porteeDemandee !== "" && porteeDemandee !== "guildes" && porteeDemandee !== "globale") {
		throw new Error(
			`[wonderbot] WONDERBOT_COMMAND_SCOPE="${porteeDemandee}" est inconnu. ` +
				"Valeurs acceptées : guildes, globale."
		);
	}
	// Sans guilde connue, la portée « guildes » n'enregistrerait nulle part : le
	// bot serait en ligne et muet. On publie alors globalement.
	const portee: PorteeCommandes =
		porteeDemandee === "globale" || (porteeDemandee === "" && guildes.length === 0)
			? "globale"
			: "guildes";

	const salon = (env.WONDERBOT_ANNOUNCE_CHANNEL_ID ?? "").trim();
	const forum = (env.WONDERBOT_FORUM_CHANNEL_ID ?? "").trim();
	const role = (env.WONDERBOT_ANNOUNCE_ROLE_ID ?? "").trim();

	return {
		jeton: verifierSecret(jeton.variable, jeton.valeur),
		applicationId: application.valeur,
		guildes,
		portee,
		cheminCache: cheminCacheParDefaut(env),
		salonAnnonces: FLOCON.test(salon) ? salon : null,
		salonForum: FLOCON.test(forum) ? forum : null,
		roleAnnonces: FLOCON.test(role) ? role : null,
		rolesStaff: lireFlocons(env.WONDERBOT_STAFF_ROLE_IDS),
		intervalleRafraichissementMs: lireEntier(env.WONDERBOT_REFRESH_INTERVAL_MS, {
			defaut: INTERVALLE_PAR_DEFAUT_MS,
			minimum: INTERVALLE_MINIMUM_MS,
		}),
		plafondAnnonces: lireEntier(env.WONDERBOT_ANNOUNCE_LIMIT, {
			defaut: PLAFOND_ANNONCES_PAR_DEFAUT,
			minimum: 1,
		}),
		// Actif par défaut : un catalogue périmé est le défaut le plus visible
		// pour un membre, et le plus silencieux pour l'exploitant.
		rafraichirAuDemarrage: (env.WONDERBOT_REFRESH_ON_START ?? "1").trim() !== "0",
		tentativesReparation: Number.parseInt((env.WONDERBOT_AUTOFIX_ATTEMPTS ?? "").trim(), 10) >= 0
			? Number.parseInt((env.WONDERBOT_AUTOFIX_ATTEMPTS ?? "").trim(), 10)
			: TENTATIVES_REPARATION_PAR_DEFAUT,
		delaiReparationMs: lireEntier(env.WONDERBOT_AUTOFIX_DELAY_MS, {
			defaut: DELAI_REPARATION_PAR_DEFAUT_MS,
			minimum: 60_000,
		}),
		marque: MARQUE_PAR_DEFAUT,
	};
}

/**
 * Résumé sans secret, pour le journal de démarrage. Le jeton n'y figure pas —
 * pas même tronqué : un préfixe de jeton suffit à identifier l'application.
 */
export function resumerConfig(config: ConfigWonderbot): string {
	const portee =
		config.portee === "globale"
			? "globale (tout serveur qui invite le bot)"
			: `guildes ${config.guildes.join(", ")}`;
	const forum = config.salonForum ? `forum ${config.salonForum}` : "forum désactivé";
	const annonces = config.salonAnnonces
		? `salon ${config.salonAnnonces}${config.roleAnnonces ? ` (mention <@&${config.roleAnnonces}>)` : ""}`
		: "désactivées";
	const heures = (config.intervalleRafraichissementMs / 3_600_000).toFixed(1);
	const reparation =
		config.tentativesReparation > 0
			? `réparation ${config.tentativesReparation} tentative(s) après ${(config.delaiReparationMs / 60_000).toFixed(0)} min`
			: "réparation désactivée";
	return [
		`application ${config.applicationId}`,
		`commandes ${portee}`,
		`catalogue ${config.cheminCache}`,
		`rafraîchissement toutes les ${heures} h`,
		`annonces ${annonces}`,
		forum,
		reparation,
	].join(" · ");
}
