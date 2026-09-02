/**
 * `/episodes` — la seule racine de commandes de Wonderbot.
 *
 * ⚠ Le nom de la commande, ses descriptions et ses réponses sont PUBLICS : ils
 * s'affichent dans le client Discord de chaque membre. Aucun n'emploie de nom
 * déposé — la racine s'appelait `/ietv`, elle a été renommée pour cette raison.
 *
 * ── LES HANDLERS NE CONNAISSENT PAS DISCORD.JS ─────────────────────────────
 * Chaque sous-commande reçoit des options déjà lues et rend une {@link Reponse}
 * (des embeds au format de l'API). C'est le pont, dans `bot.ts`, qui traduit
 * une `ChatInputCommandInteraction` en appel et repose la réponse. Résultat :
 * toute la logique de commande se teste avec un objet littéral, sans passerelle,
 * sans jeton et sans serveur.
 */

import {
	ICONES,
	echec,
	fiche,
	horodatageRelatif,
	libelleLangue,
	listerEpisodes,
	repartitionLangues,
	succes,
	vide,
	type Marque,
	type Reponse,
} from "../ui/index.ts";
import type { Catalogue } from "../catalogue.ts";

/**
 * Types d'options de l'API Discord. Recopiés plutôt qu'importés de discord.js :
 * ce module doit rester chargeable — et testable — sans la bibliothèque.
 * (`ApplicationCommandOptionType`, valeurs stables depuis l'API v8.)
 */
const TYPE = { sousCommande: 1, chaine: 3, entier: 4 } as const;

const CHOIX_LANGUE = [
	{ name: "VF (doublage français)", value: "vf" },
	{ name: "VOSTFR (VO sous-titrée)", value: "vostfr" },
] as const;

/** Nombre maximal d'épisodes qu'une réponse liste. */
const LIMITE_MAX = 25;
const LIMITE_DEFAUT = 10;

/**
 * Définition envoyée à Discord. Un objet JSON, pas un `SlashCommandBuilder` :
 * `client.application.commands.set()` accepte les deux, et celui-ci se compare
 * dans un test.
 */
export const DEFINITION_IETV = {
	name: "episodes",
	description: "Le catalogue d'épisodes du serveur — VF et VOSTFR",
	options: [
		{
			type: TYPE.sousCommande,
			name: "recherche",
			description: "Chercher un épisode par titre",
			options: [
				{
					type: TYPE.chaine,
					name: "texte",
					description: "Titre, mot-clé, nom d'arc…",
					required: true,
				},
				{
					type: TYPE.chaine,
					name: "langue",
					description: "Ne garder qu'une version",
					choices: CHOIX_LANGUE,
				},
				{
					type: TYPE.entier,
					name: "limite",
					description: `Nombre de résultats (1 à ${LIMITE_MAX})`,
					min_value: 1,
					max_value: LIMITE_MAX,
				},
			],
		},
		{
			type: TYPE.sousCommande,
			name: "episode",
			description: "Toutes les versions d'un épisode précis",
			options: [
				{
					type: TYPE.entier,
					name: "saison",
					description: "Numéro de saison",
					required: true,
					min_value: 1,
				},
				{
					type: TYPE.entier,
					name: "numero",
					description: "Numéro d'épisode dans la saison",
					required: true,
					min_value: 1,
				},
				{
					type: TYPE.chaine,
					name: "langue",
					description: "Ne garder qu'une version",
					choices: CHOIX_LANGUE,
				},
			],
		},
		{
			type: TYPE.sousCommande,
			name: "saison",
			description: "Les épisodes d'une saison",
			options: [
				{
					type: TYPE.entier,
					name: "numero",
					description: "Numéro de saison",
					required: true,
					min_value: 1,
				},
				{
					type: TYPE.chaine,
					name: "langue",
					description: "Ne garder qu'une version",
					choices: CHOIX_LANGUE,
				},
			],
		},
		{
			type: TYPE.sousCommande,
			name: "catalogue",
			description: "État du catalogue : sources, volumes, fraîcheur",
		},
		{
			type: TYPE.sousCommande,
			name: "rafraichir",
			description: "Rescraper toutes les sources (staff)",
		},
	],
} as const;

/**
 * Sous-commandes dont la réponse ne regarde que l'appelant.
 *
 * Le choix se fait AVANT l'exécution, et ce n'est pas un détail : Discord fige
 * la visibilité au `deferReply`. Une réponse différée publiquement ne peut plus
 * devenir éphémère, `editReply` refuse le drapeau. `rafraichir` est du bruit
 * d'exploitation — il n'a rien à faire dans le fil d'un salon public.
 */
const SOUS_COMMANDES_PRIVEES = new Set(["rafraichir"]);

/** La réponse à cette sous-commande doit-elle être privée ? */
export function reponsePrivee(sousCommande: string): boolean {
	return SOUS_COMMANDES_PRIVEES.has(sousCommande);
}

/** Options d'une interaction, déjà lues — un objet littéral suffit en test. */
export interface OptionsCommande {
	chaine(nom: string): string | null;
	entier(nom: string): number | null;
}

/** Lecteur d'options à partir d'un simple objet. */
export function optionsDepuisObjet(source: Record<string, string | number | undefined>): OptionsCommande {
	return {
		chaine: (nom) => {
			const valeur = source[nom];
			return typeof valeur === "string" ? valeur : null;
		},
		entier: (nom) => {
			const valeur = source[nom];
			return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
		},
	};
}

export interface ContexteCommande {
	catalogue: Catalogue;
	marque: Marque;
	/** Vrai si l'appelant a le droit de déclencher un rafraîchissement. */
	estStaff: boolean;
	/** Plafond d'affichage des annonces, repris dans le résumé. */
	now?: () => number;
}

type Langue = "vf" | "vostfr";

function lireLangue(options: OptionsCommande): Langue | undefined {
	const brut = options.chaine("langue");
	return brut === "vf" || brut === "vostfr" ? brut : undefined;
}

/** Plateformes dont Discord sait rendre un lecteur inline. */
const HOTES_LISIBLES = ["youtube.com", "youtu.be", "twitch.tv", "vimeo.com", "dailymotion.com"];

/**
 * L'URL produit-elle un lecteur dans Discord ?
 *
 * Discord n'intègre de lecteur que pour les plateformes qu'il connaît. Une page
 * de site, même si elle contient une vidéo, ne rend qu'une carte. Le test porte
 * sur l'HÔTE, pas sur la chaîne entière : un chemin contenant « youtube » sur un
 * autre domaine ne doit pas passer pour lisible.
 */
export function estLisibleEnLigne(url: string): boolean {
	let hote: string;
	try {
		hote = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return false;
	}
	return HOTES_LISIBLES.some((connu) => hote === connu || hote.endsWith(`.${connu}`));
}

/**
 * `2009-04-08` → `<t:…:D>`, l'horodatage natif de Discord.
 *
 * Il s'affiche dans le fuseau et la langue de chaque lecteur, là où une date
 * écrite en dur impose le format de celui qui l'a produite.
 */
export function dateLisible(iso: string): string {
	const instant = Date.parse(`${iso}T12:00:00Z`);
	return Number.isFinite(instant) ? `<t:${Math.floor(instant / 1000)}:D>` : iso;
}

/** Suffixe `(VF)` accolé aux titres quand un filtre de langue est actif. */
function mentionLangue(langue: Langue | undefined): string {
	return langue ? ` — ${libelleLangue(langue)}` : "";
}

/**
 * Exécute une sous-commande de `/ietv`.
 *
 * Une sous-commande inconnue rend un échec plutôt que de lever : Discord a déjà
 * accusé réception de l'interaction, une exception ici laisserait le membre
 * devant un « L'application n'a pas répondu » sans explication.
 */
export async function executerIetv(
	sousCommande: string,
	options: OptionsCommande,
	contexte: ContexteCommande
): Promise<Reponse> {
	switch (sousCommande) {
		case "recherche":
			return recherche(options, contexte);
		case "episode":
			return episode(options, contexte);
		case "saison":
			return saison(options, contexte);
		case "catalogue":
			return catalogue(contexte);
		case "rafraichir":
			return rafraichir(contexte);
		default:
			return echec(
				"Sous-commande inconnue",
				`\`${sousCommande}\` n'existe pas. Tape \`/episodes\` et choisis dans la liste.`,
				contexte.marque
			);
	}
}

function recherche(options: OptionsCommande, contexte: ContexteCommande): Reponse {
	const texte = (options.chaine("texte") ?? "").trim();
	if (texte === "") {
		return echec("Recherche vide", "Donne au moins un mot à chercher.", contexte.marque);
	}

	const langue = lireLangue(options);
	const limite = Math.min(options.entier("limite") ?? LIMITE_DEFAUT, LIMITE_MAX);
	const resultats = contexte.catalogue.rechercher({
		texte,
		...(langue ? { langue } : {}),
		limite,
	});

	if (resultats.length === 0) {
		return vide(
			"Aucun épisode",
			`Rien pour « ${texte} »${mentionLangue(langue)}. Essaie un mot-clé plus court, ` +
				"ou `/episodes saison` pour parcourir une saison entière.",
			contexte.marque
		);
	}

	const liste = listerEpisodes(resultats, { limite });
	return {
		embeds: [
			fiche({
				titre: `${ICONES.recherche} « ${texte} »${mentionLangue(langue)}`,
				marque: contexte.marque,
			})
				.description(liste.texte)
				.finir(`${liste.affiches} sur ${resultats.length}`),
		],
	};
}

function episode(options: OptionsCommande, contexte: ContexteCommande): Reponse {
	const saisonDemandee = options.entier("saison");
	const numero = options.entier("numero");
	if (saisonDemandee === null || numero === null) {
		return echec(
			"Épisode incomplet",
			"Il faut la saison ET le numéro : `/episodes episode saison:1 numero:5`.",
			contexte.marque
		);
	}

	const langue = lireLangue(options);
	const versions = contexte.catalogue.episode(saisonDemandee, numero, langue);

	if (versions.length === 0) {
		const disponibles = contexte.catalogue.saisonsDisponibles();
		const piste =
			disponibles.length === 0
				? "Le catalogue est vide : lance `/episodes rafraichir` ou attends le prochain passage."
				: `Saisons au catalogue : ${disponibles.join(", ")}.`;
		return vide(
			`S${saisonDemandee}E${numero} introuvable`,
			`Aucune version${mentionLangue(langue)} pour cet épisode. ${piste}`,
			contexte.marque
		);
	}

	const principal = versions[0]!;
	const f = fiche({
		titre: `${ICONES.episode} Saison ${saisonDemandee}, épisode ${numero}`,
		marque: contexte.marque,
	})
		.description(principal.description ?? "")
		.miniature(principal.thumbnail);

	// Titre original et date de première diffusion : ils viennent de la
	// chronologie et n'existent sur aucune des sources vidéo.
	const original = [principal.titleJp, principal.romaji].filter(Boolean).join(" · ");
	if (original) f.champ("Titre original", original, { enLigne: true });
	if (principal.publishDate) {
		f.champ("Première diffusion", dateLisible(principal.publishDate), { enLigne: true });
	}

	// Un champ par version : le même épisode existe en VF et en VOSTFR, souvent
	// sur plusieurs chaînes. Les empiler dans la description perdrait le lien.
	for (const version of versions) {
		f.champ(
			`${libelleLangue(version.language)}${version.channel ? ` · ${version.channel}` : ""}`,
			`[${version.title}](${version.url})`
		);
	}

	// URL nue en contenu : c'est ce que Discord transforme en lecteur. On prend
	// la première version lisible en ligne — une page de site ne donne qu'une
	// carte, seule une URL de plateforme vidéo produit un lecteur.
	const jouable = versions.find((version) => estLisibleEnLigne(version.url));

	return {
		embeds: [f.finir(`${versions.length} version(s)`)],
		...(jouable ? { contenu: jouable.url } : {}),
	};
}

function saison(options: OptionsCommande, contexte: ContexteCommande): Reponse {
	const numero = options.entier("numero");
	if (numero === null) {
		return echec("Saison manquante", "Précise la saison : `/episodes saison numero:2`.", contexte.marque);
	}

	const langue = lireLangue(options);
	const episodes = contexte.catalogue.saison(numero, langue);

	if (episodes.length === 0) {
		const disponibles = contexte.catalogue.saisonsDisponibles();
		return vide(
			`Saison ${numero} absente`,
			disponibles.length === 0
				? "Le catalogue est vide : lance `/episodes rafraichir`."
				: `Saisons au catalogue : ${disponibles.join(", ")}.`,
			contexte.marque
		);
	}

	const liste = listerEpisodes(episodes, { limite: LIMITE_MAX });
	return {
		embeds: [
			fiche({
				titre: `${ICONES.saison} Saison ${numero}${mentionLangue(langue)}`,
				marque: contexte.marque,
			})
				.description(liste.texte)
				.finir(`${liste.affiches} sur ${episodes.length}`),
		],
	};
}

function catalogue(contexte: ContexteCommande): Reponse {
	const resume = contexte.catalogue.resume();

	if (resume.stats.episodes === 0) {
		return vide(
			"Catalogue vide",
			"Aucun épisode en base. Le premier rafraîchissement n'a pas encore tourné — " +
				"`/episodes rafraichir` le déclenche tout de suite.",
			contexte.marque
		);
	}

	const f = fiche({ titre: `${ICONES.catalogue} Catalogue IETV`, marque: contexte.marque })
		.champ("Épisodes", String(resume.stats.episodes), { enLigne: true })
		.champ("Saisons", String(resume.stats.seasons), { enLigne: true })
		.champ("Sources", String(resume.stats.channels), { enLigne: true })
		.champ("Versions", repartitionLangues(resume.stats.byLanguage))
		.champ(
			`${ICONES.horloge} Dernier rafraîchissement`,
			horodatageRelatif(resume.dernierRafraichissement)
		);

	const sources = resume.sources
		.slice(0, 10)
		.map((source) => `• **${source.titre ?? source.nom}** — ${source.episodes} épisode(s)`)
		.join("\n");
	if (sources !== "") f.champ("Détail des sources", sources);

	return { embeds: [f.finir()] };
}

async function rafraichir(contexte: ContexteCommande): Promise<Reponse> {
	if (!contexte.estStaff) {
		return echec(
			"Réservé au staff",
			"Le rafraîchissement rescrape toutes les sources : il est réservé aux administrateurs " +
				"du serveur et aux rôles déclarés dans `WONDERBOT_STAFF_ROLE_IDS`. Le catalogue se " +
				"met à jour tout seul, régulièrement.",
			contexte.marque
		);
	}

	try {
		const resultat = await contexte.catalogue.rafraichir();
		const secondes = (resultat.dureeMs / 1000).toFixed(1);
		const details = [
			`${resultat.stats.episodes} épisode(s) sur ${resultat.sources} source(s), en ${secondes} s.`,
			resultat.nouveaux.length > 0
				? `${ICONES.nouveau} ${resultat.nouveaux.length} nouveauté(s) depuis le dernier passage.`
				: "Aucune nouveauté depuis le dernier passage.",
		].join("\n");
		return succes("Catalogue rafraîchi", details, contexte.marque);
	} catch (err) {
		return echec(
			"Rafraîchissement échoué",
			`${err instanceof Error ? err.message : String(err)}\n\n` +
				"Le catalogue précédent est conservé : les autres commandes répondent toujours.",
			contexte.marque
		);
	}
}
