/**
 * Charte visuelle de Wonderbot — couleurs, icônes, limites de l'API Discord.
 *
 * Module PUR : aucune dépendance à discord.js, aucun effet de bord. Ce qui rend
 * les réponses d'un bot lisibles n'est pas la richesse d'un embed isolé, c'est
 * la répétition — la même couleur veut toujours dire la même chose. Aucune
 * commande n'écrit une couleur ni une limite en dur : tout passe par ici.
 */

/** Couleurs d'intention, en entiers 24 bits (ce qu'attend discord.js). */
export const COULEURS = {
	/** Réponse normale — l'écrasante majorité. Bleu Inazuma. */
	marque: 0x2e6be6,
	/** Une action a abouti. */
	succes: 0x3ba55d,
	/** Résultat partiel, donnée périmée, limite atteinte. */
	attention: 0xfaa61a,
	/** L'action a échoué. */
	echec: 0xed4245,
	/** Rappel de syntaxe, renvoi vers une autre commande. */
	info: 0x5865f2,
	/** Vrai mais accessoire : liste vide, aucun résultat. */
	muet: 0x2b2d31,
} as const;

export type Intention = keyof typeof COULEURS;

/**
 * Une icône par idée, toujours la même, toujours Unicode : une émoji
 * personnalisée n'existe que sur le serveur qui la porte.
 */
export const ICONES = {
	recherche: "🔎",
	episode: "▶️",
	saison: "📚",
	catalogue: "🗂️",
	rafraichir: "🔄",
	nouveau: "🆕",
	succes: "✅",
	echec: "⛔",
	attention: "⚠️",
	vide: "🫥",
	vf: "🇫🇷",
	vostfr: "💬",
	inconnu: "❔",
	horloge: "🕒",
	lien: "🔗",
} as const;

/**
 * Limites dures de l'API Discord. Les dépasser fait refuser le message entier
 * (`Invalid Form Body`), pas tronquer : c'est à nous de tenir le budget.
 */
export const LIMITES = {
	/** Titre d'un embed. */
	titre: 256,
	/** Description d'un embed. */
	description: 4096,
	/** Nom d'un champ. */
	nomChamp: 256,
	/** Valeur d'un champ. */
	valeurChamp: 1024,
	/** Pied de page. */
	pied: 2048,
	/** Somme de tous les textes d'un embed. */
	totalEmbed: 6000,
	/** Champs par embed. */
	champs: 25,
	/** Choix d'une autocomplétion. */
	choixAutocompletion: 25,
} as const;

/** Identité affichée par le bot. */
export interface Marque {
	nom: string;
	/** Pied de page des embeds — ce que le bot représente. */
	piedDePage: string;
	couleur: number;
}

/**
 * Identité affichée sur Discord.
 *
 * ⚠ Le pied de page est PUBLIC : il apparaît sous chaque réponse du bot. Il ne
 * nomme donc aucune marque déposée — le bot parle de « catalogue d'épisodes ».
 */
export const MARQUE_PAR_DEFAUT: Marque = Object.freeze({
	nom: "Wonderbot",
	piedDePage: "catalogue d'épisodes",
	couleur: COULEURS.marque,
});
