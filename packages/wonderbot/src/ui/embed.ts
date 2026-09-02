/**
 * Construction des embeds — la seule fabrique d'embeds du bot.
 *
 * Elle rend des objets JSON conformes à l'API Discord (`APIEmbed`), pas des
 * `EmbedBuilder` : les commandes deviennent testables sans discord.js, et
 * discord.js accepte ces objets tels quels dans `embeds: [...]`.
 *
 * ── LE BUDGET SE TIENT À L'AJOUT ───────────────────────────────────────────
 * Discord refuse le message ENTIER au-delà de 6 000 caractères cumulés — il ne
 * tronque pas. Un champ qui ne rentre plus n'est donc pas posé, et `tronquee`
 * passe à `true` : mieux vaut une fiche incomplète et affichée qu'un
 * `Invalid Form Body` et rien du tout.
 */

import { bornerTexte } from "./format.ts";
import { COULEURS, ICONES, LIMITES, MARQUE_PAR_DEFAUT, type Intention, type Marque } from "./theme.ts";

/** Embed au format de l'API Discord. */
export interface Embed {
	title?: string;
	description?: string;
	url?: string;
	color?: number;
	fields?: { name: string; value: string; inline?: boolean }[];
	footer?: { text: string };
	thumbnail?: { url: string };
	image?: { url: string };
	timestamp?: string;
}

/** Ce qu'une commande rend, et que le bot passe tel quel à `editReply`. */
export interface Reponse {
	embeds: Embed[];
	/**
	 * Texte du message, à côté des embeds.
	 *
	 * ── C'EST LA SEULE FAÇON D'OBTENIR UN LECTEUR ──────────────────────────
	 * Discord ne rend un lecteur vidéo que pour une URL **nue en contenu de
	 * message**. Un lien Markdown dans une description d'embed ne produit
	 * rien : il reste un lien. Une commande qui veut faire jouer une vidéo
	 * dans Discord doit donc poser son URL ici.
	 */
	contenu?: string;
	/** Réponse visible du seul appelant. */
	prive?: boolean;
}

export interface OptionsFiche {
	titre: string;
	description?: string;
	url?: string;
	intention?: Intention;
	marque?: Marque;
}

/** Somme des textes d'un embed, telle que Discord la compte. */
export function tailleEmbed(embed: Embed): number {
	let total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
	total += embed.footer?.text.length ?? 0;
	for (const champ of embed.fields ?? []) total += champ.name.length + champ.value.length;
	return total;
}

export class Fiche {
	private readonly embed: Embed;
	private readonly marque: Marque;
	/** Vrai dès qu'un champ a dû être refusé faute de budget. */
	tronquee = false;

	constructor(options: OptionsFiche) {
		this.marque = options.marque ?? MARQUE_PAR_DEFAUT;
		this.embed = {
			title: bornerTexte(options.titre, LIMITES.titre),
			color: COULEURS[options.intention ?? "marque"] ?? this.marque.couleur,
		};
		if (options.url) this.embed.url = options.url;
		if (options.description) this.description(options.description);
	}

	description(texte: string): this {
		this.embed.description = bornerTexte(texte, LIMITES.description);
		return this;
	}

	champ(nom: string, valeur: string, options: { enLigne?: boolean } = {}): this {
		const champs = (this.embed.fields ??= []);
		if (champs.length >= LIMITES.champs) {
			this.tronquee = true;
			return this;
		}

		const candidat = {
			name: bornerTexte(nom, LIMITES.nomChamp),
			value: bornerTexte(valeur, LIMITES.valeurChamp),
			...(options.enLigne ? { inline: true } : {}),
		};

		// Le pied n'est posé qu'à `finir()` : on lui garde sa place ici, sinon
		// un dernier champ pile à la limite ferait refuser le message.
		const reserve = this.marque.piedDePage.length + 64;
		if (tailleEmbed(this.embed) + candidat.name.length + candidat.value.length + reserve > LIMITES.totalEmbed) {
			this.tronquee = true;
			return this;
		}

		champs.push(candidat);
		return this;
	}

	miniature(url: string | null): this {
		if (url) this.embed.thumbnail = { url };
		return this;
	}

	image(url: string | null): this {
		if (url) this.embed.image = { url };
		return this;
	}

	/** Pose le pied de page et rend l'embed. */
	finir(note?: string): Embed {
		const morceaux = [note, this.marque.nom, this.marque.piedDePage].filter(
			(part): part is string => typeof part === "string" && part.length > 0
		);
		const pied = bornerTexte(
			this.tronquee ? `${morceaux.join(" · ")} · ${ICONES.attention} affichage tronqué` : morceaux.join(" · "),
			LIMITES.pied
		);
		return { ...this.embed, footer: { text: pied } };
	}
}

export function fiche(options: OptionsFiche): Fiche {
	return new Fiche(options);
}

/** Charge d'une action réussie. */
export function succes(titre: string, details: string, marque?: Marque): Reponse {
	return {
		embeds: [fiche({ titre: `${ICONES.succes} ${titre}`, intention: "succes", marque }).description(details).finir()],
	};
}

/**
 * Charge d'un échec. `quoiFaire` n'est pas décoratif : un message d'erreur qui
 * ne dit pas quoi faire ensuite oblige le membre à demander au staff.
 */
export function echec(titre: string, quoiFaire: string, marque?: Marque): Reponse {
	return {
		embeds: [fiche({ titre: `${ICONES.echec} ${titre}`, intention: "echec", marque }).description(quoiFaire).finir()],
		prive: true,
	};
}

/** Charge d'un résultat vide — ce n'est pas une erreur, la couleur le dit. */
export function vide(titre: string, piste: string, marque?: Marque): Reponse {
	return {
		embeds: [fiche({ titre: `${ICONES.vide} ${titre}`, intention: "muet", marque }).description(piste).finir()],
	};
}
