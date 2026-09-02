/**
 * Chronologie depuis Wikipédia — module PUR.
 *
 * ── CE QUE CETTE SOURCE APPORTE, ET QUE LES AUTRES N'ONT PAS ───────────────
 * Le site officiel donne des épisodes jouables mais aucune date : `publishDate`
 * valait `null` partout. Wikipédia publie, arc par arc, le numéro, le titre
 * français, le titre japonais, son rōmaji et la **date de première diffusion**.
 * C'est la chronologie, et c'est aussi un décompte de référence : savoir qu'un
 * arc compte 41 épisodes permet de dire si le catalogue est complet, au lieu de
 * seulement constater ce qu'on a.
 *
 * ── ON LIT L'API, PAS LA PAGE ──────────────────────────────────────────────
 * `action=parse` rend le HTML déjà assemblé par MediaWiki, sans les gabarits ni
 * la mise en page du site. C'est une interface publique et documentée, là où
 * gratter `fr.wikipedia.org` casserait au premier changement d'habillage.
 *
 * ── LA NUMÉROTATION EST ABSOLUE ────────────────────────────────────────────
 * Wikipédia numérote d'une traite : la saison 2 va de 27 à 67, la saison 3 de
 * 68 à 127. Le rang DANS la section donne donc le numéro d'épisode relatif à
 * l'arc, le seul qui corresponde au découpage du site officiel. Les deux sont
 * conservés : l'absolu sert à recouper les titres YouTube, qui l'emploient.
 */

/** Un épisode tel que Wikipédia le décrit. */
export interface EpisodeWiki {
	/** Rang dans l'arc — celui du site officiel (1 à 41 pour la saison 2). */
	numero: number;
	/** Numéro continu de Wikipédia (27 à 67 pour la saison 2). */
	numeroAbsolu: number;
	titreFr: string | null;
	titreJp: string | null;
	romaji: string | null;
	/** Première diffusion, en ISO `AAAA-MM-JJ` quand la date est lisible. */
	diffusion: string | null;
}

/** Une section de la page : un arc et ses épisodes. */
export interface SectionWiki {
	titre: string;
	episodes: EpisodeWiki[];
}

const MOIS: Record<string, string> = {
	janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04",
	mai: "05", juin: "06", juillet: "07", août: "08", aout: "08",
	septembre: "09", octobre: "10", novembre: "11", décembre: "12", decembre: "12",
};

/** Retire le balisage et décode les entités d'une cellule. */
export function texteCellule(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;| /g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * `5 octobre 2008` → `2008-10-05`.
 *
 * Rend `null` sur une date illisible plutôt qu'une valeur inventée : une date
 * fausse est pire qu'une date absente, elle se propage dans les tris.
 */
export function normaliserDate(texte: string): string | null {
	const trouve = /(\d{1,2})\s*(?:er)?\s+([a-zéûôA-ZÉ]+)\s+(\d{4})/.exec(texte);
	if (!trouve) return null;
	const mois = MOIS[trouve[2]!.toLowerCase()];
	if (!mois) return null;
	return `${trouve[3]}-${mois}-${trouve[1]!.padStart(2, "0")}`;
}

/**
 * Sections de la page et leurs épisodes.
 *
 * On découpe sur les titres de niveau 2 ET 3 : la page mêle les deux — les
 * trois premières saisons sont des sous-sections, les séries suivantes des
 * sections à part entière.
 */
export function parserListeEpisodes(html: string): SectionWiki[] {
	const sections: SectionWiki[] = [];
	const morceaux = html.split(/<h[23][^>]*>/);

	for (const morceau of morceaux.slice(1)) {
		const finTitre = morceau.search(/<\/h[23]>/);
		if (finTitre === -1) continue;
		const titre = texteCellule(morceau.slice(0, finTitre)).replace(/\[modifier.*$/i, "").trim();

		const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(morceau);
		if (!table) continue;

		const episodes: EpisodeWiki[] = [];
		for (const ligne of table[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
			const cellules = [...ligne[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
				texteCellule(c[1]!)
			);
			// Une ligne d'épisode commence par son numéro ; les lignes d'en-tête
			// et les intertitres d'arc ne satisfont pas cette forme.
			if (cellules.length < 2 || !/^\d{1,3}$/.test(cellules[0]!)) continue;

			const numeroAbsolu = Number.parseInt(cellules[0]!, 10);
			const dateBrute = cellules.find((cellule) => normaliserDate(cellule) !== null);

			episodes.push({
				numero: episodes.length + 1,
				numeroAbsolu,
				titreFr: cellules[1] || null,
				titreJp: cellules[2] || null,
				romaji: cellules[3] || null,
				diffusion: dateBrute ? normaliserDate(dateBrute) : null,
			});
		}

		if (episodes.length > 0) sections.push({ titre, episodes });
	}

	return sections;
}

/**
 * Numéro d'arc du catalogue correspondant à une section Wikipédia.
 *
 * L'ordre du site officiel fait autorité (Saison 1/2/3, GO, Chrono Stones,
 * Galaxy, Outer Code, Ares, Orion, Films) ; Wikipédia nomme les mêmes arcs
 * autrement et n'en couvre pas deux — Outer Code et les films n'y ont pas de
 * liste d'épisodes. Ceux-là restent sans chronologie, ce qui est exact.
 */
export function arcDeSection(titre: string): number | null {
	const t = titre.toLowerCase();
	if (/saison\s*1\b/.test(t)) return 1;
	if (/saison\s*2\b/.test(t)) return 2;
	if (/saison\s*3\b/.test(t)) return 3;
	// L'ordre compte : « GO: Chrono Stone » et « GO: Galaxy » contiennent « go ».
	if (/chrono\s*stone/.test(t)) return 5;
	if (/galaxy/.test(t)) return 6;
	if (/\bares\b/.test(t)) return 8;
	if (/orion/.test(t)) return 9;
	if (/\bgo\b/.test(t)) return 4;
	return null;
}

/** Clé d'appariement d'un épisode : `arc:numéro`. */
export function cleEpisode(arc: number, numero: number): string {
	return `${arc}:${numero}`;
}

/**
 * Chronologie indexée par `arc:numéro`, prête à enrichir le catalogue.
 *
 * Les sections qu'on ne sait pas rattacher à un arc sont ignorées : mieux vaut
 * une chronologie partielle qu'un épisode daté avec la date d'un autre.
 */
export function indexerChronologie(sections: readonly SectionWiki[]): Map<string, EpisodeWiki> {
	const index = new Map<string, EpisodeWiki>();
	for (const section of sections) {
		const arc = arcDeSection(section.titre);
		if (arc === null) continue;
		for (const episode of section.episodes) {
			index.set(cleEpisode(arc, episode.numero), episode);
		}
	}
	return index;
}

/** URL de l'API MediaWiki rendant le HTML assemblé d'une page. */
export function urlApiWiki(hote: string, page: string): string {
	return (
		`https://${hote}/w/api.php?action=parse&page=${encodeURIComponent(page)}` +
		"&prop=text&formatversion=2&format=json"
	);
}
