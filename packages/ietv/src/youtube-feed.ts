/**
 * Lecture des chaînes YouTube par leur flux Atom — module PUR.
 *
 * ── POURQUOI PAS LA PAGE DE LA CHAÎNE ──────────────────────────────────────
 * L'onglet `/videos` ne rend plus sa grille dans le HTML servi : mesuré le
 * 2026-09-02, 800 Ko de page pour **zéro** occurrence de `"videoId"`, un
 * `richGridRenderer` ne contenant qu'un `continuationItemRenderer`. La grille
 * ne vient plus que d'un appel `youtubei/v1/browse`, et depuis cette machine
 * cet appel répond 200 avec zéro vidéo — quel que soit le jeton de continuation
 * (les cinq de la page ont été essayés) et quel que soit le cookie de
 * consentement (`SOCS`, `CONSENT`). Ce n'est donc pas un défaut de parsing.
 *
 * Le flux Atom, lui, répond : `feeds/videos.xml?channel_id=UC…` rend les
 * quinze dernières mises en ligne, avec identifiant, titre et date.
 *
 * ── CE QUE ÇA COÛTE, ET CE QUE ÇA VAUT ─────────────────────────────────────
 * Quinze vidéos, c'est le plafond du flux : ce n'est PAS le fond de catalogue.
 * C'est en revanche exactement ce qu'il faut pour repérer les nouveautés, et
 * le fond, lui, vient du site officiel. Une source qui rend quinze épisodes
 * fiables vaut mieux qu'une source qui en rend zéro.
 */

/** Une entrée du flux Atom d'une chaîne. */
export interface EntreeFlux {
	videoId: string;
	titre: string;
	url: string;
	/** Date de publication ISO 8601, telle que donnée par le flux. */
	publie: string | null;
	/** Nom de la chaîne, porté par le flux lui-même. */
	chaine: string | null;
}

/** Contenu textuel de la première balise `nom`, entités XML décodées. */
function baliseTexte(xml: string, nom: string): string | null {
	const trouve = new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`).exec(xml);
	return trouve ? decoderEntites(trouve[1]!) : null;
}

/** Décode les entités XML d'un texte de flux. */
export function decoderEntites(texte: string): string {
	return texte
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#3[49];/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/**
 * Entrées d'un flux Atom YouTube.
 *
 * Une entrée sans identifiant est ignorée plutôt que fatale : un flux tronqué
 * doit rendre ce qu'il a, pas rien.
 */
export function parserFluxYoutube(xml: string): EntreeFlux[] {
	// Le titre de la chaîne est le premier `<title>` du document, avant la
	// première `<entry>` : le prendre après ferait remonter un titre de vidéo.
	const avantEntrees = xml.split("<entry>", 1)[0] ?? "";
	const chaine = baliseTexte(avantEntrees, "title");

	const entrees: EntreeFlux[] = [];
	for (const bloc of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
		const corps = bloc[1]!;
		const videoId = baliseTexte(corps, "yt:videoId");
		const titre = baliseTexte(corps, "title");
		if (!videoId || !titre) continue;

		entrees.push({
			videoId,
			titre,
			url: `https://www.youtube.com/watch?v=${videoId}`,
			publie: baliseTexte(corps, "published"),
			chaine,
		});
	}
	return entrees;
}

/**
 * Identifiant de chaîne (`UC…`) trouvé dans le HTML d'une page de chaîne.
 *
 * Deux formes coexistent selon la page servie : le lien du flux RSS et le champ
 * `externalId` de la configuration. On accepte les deux.
 */
export function extraireChannelId(html: string): string | null {
	const trouve =
		/channel_id=(UC[A-Za-z0-9_-]{22})/.exec(html) ??
		/"externalId":"(UC[A-Za-z0-9_-]{22})"/.exec(html) ??
		/"channelId":"(UC[A-Za-z0-9_-]{22})"/.exec(html);
	return trouve ? trouve[1]! : null;
}

/** URL du flux Atom d'une chaîne. */
export function urlFlux(channelId: string): string {
	return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/**
 * Langue déduite du NOM d'une chaîne, quand son titre n'en dit rien.
 *
 * ── POURQUOI CE N'EST PAS DANS `detectLanguage` ────────────────────────────
 * `detectLanguage` ne voit que le titre d'une vidéo. Or « Inazuma Eleven France
 * - Épisode 127 » ne porte aucun marqueur : la langue est dans le nom de la
 * CHAÎNE, pas dans celui de l'épisode. Sans ce contexte, 29 épisodes de
 * doublage français restaient classés « langue inconnue ».
 *
 * La déduction ne s'applique QUE faute de marqueur explicite : une chaîne
 * française qui publie une vidéo intitulée « [VOSTFR] … » reste en VOSTFR.
 * Rend `null` quand le nom ne tranche pas — mieux vaut inconnu que faux.
 */
export function langueDeChaine(handle: string, titre: string | null): "vf" | "vostfr" | null {
	const contexte = `${handle} ${titre ?? ""}`.toLowerCase();
	// L'ordre compte : une chaîne « … VOSTFR » contient souvent aussi « fr ».
	if (/vostfr|sous-?titr|subbed/.test(contexte)) return "vostfr";
	if (/france|français|francais|\bvf\b/.test(contexte)) return "vf";
	return null;
}
