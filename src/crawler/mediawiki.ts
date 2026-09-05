/**
 * Repli MediaWiki : quand le HTML d'un wiki est bloqué, son API ne l'est pas.
 *
 * Mesure du 2026-09-05 sur inazuma-eleven.fandom.com, même machine, même instant :
 *
 *   GET /wiki/Afuro_Terumi                         403  (5 467 o d'interstitiel)
 *   GET /wiki/Afuro_Terumi  + UA navigateur        403  (5 680 o)
 *   GET /api.php?action=parse&page=Afuro_Terumi    200  (549 208 o de JSON)
 *   GET /rest.php/v1/page/Afuro_Terumi             200  (54 012 o)
 *
 * Fandom est derrière Cloudflare, qui protège les pages et `rest.php` mais laisse passer
 * `api.php` — c'est aussi ce que rapporte ProfessionalWiki/MediaWiki-MCP-Server#217
 * (février 2026), à ceci près que `rest.php` répond encore depuis cette IP. On vise donc
 * `api.php` en premier et `rest.php` en repli, jamais l'inverse.
 *
 * L'intérêt dépasse Fandom : MediaWiki fait tourner des dizaines de milliers de wikis
 * (Wikipedia, Miraheze, wiki.gg, des milliers d'installations privées). Un repli sur son API
 * couvre tout cet ensemble d'un coup, et rend un contenu PLUS propre que le scraping — sans
 * navigation, sans bandeau, sans menu, avec les sections et les images déjà structurées.
 */

import { htmlToMarkdown } from "../internal/html-utils.ts";

/** Hôtes dont on sait qu'ils servent MediaWiki : on passe par l'API sans même sonder. */
const HOTES_MEDIAWIKI = [/\.fandom\.com$/i, /\.wikipedia\.org$/i, /\.wikimedia\.org$/i, /\.miraheze\.org$/i, /\.wiki\.gg$/i, /\.fextralife\.com$/i];

const UA = "bxc/0.9 (+https://github.com/aphrody-dev/bxc; MediaWiki API client)";

/**
 * Fandom recommande de rester sous ~10 requêtes/minute. On tient un intervalle minimal par
 * hôte : sans cela, un crawl un peu large se fait bannir et l'API rejoint le HTML côté 403.
 */
const INTERVALLE_MIN_MS = 6_000;
const dernierAppel = new Map<string, number>();

async function respecterLeDebit(hote: string): Promise<void> {
    const precedent = dernierAppel.get(hote) ?? 0;
    const attente = precedent + INTERVALLE_MIN_MS - Date.now();
    if (attente > 0) await Bun.sleep(attente);
    dernierAppel.set(hote, Date.now());
}

export type PageMediaWiki = {
    url: string;
    title: string;
    html: string;
    markdown: string;
    wikitext: string | null;
    sections: { niveau: number; titre: string; ancre: string }[];
    images: string[];
    categories: string[];
    liens_externes: string[];
    api: "api.php" | "rest.php";
};

/** Le chemin `/wiki/<Titre>` d'un wiki, ou null si l'URL n'y ressemble pas. */
export function titreDepuisUrl(url: string): { base: string; titre: string; hote: string } | null {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    // /wiki/Titre, /<lang>/wiki/Titre (Fandom localisé), /index.php?title=Titre
    const m = u.pathname.match(/^(?:\/([a-z]{2,3}))?\/wiki\/(.+)$/i);
    const titreQuery = u.searchParams.get("title");
    const titre = m?.[2] ?? titreQuery;
    if (!titre) return null;
    // Le préfixe de langue fait partie de la base de l'API : /fr/api.php, pas /api.php.
    const prefixe = m?.[1] ? `/${m[1]}` : "";
    return { base: `${u.origin}${prefixe}`, titre: decodeURIComponent(titre), hote: u.host };
}

/** Ce domaine sert-il MediaWiki ? Connu d'avance, ou sondé via `meta=siteinfo`. */
export async function estMediaWiki(url: string): Promise<boolean> {
    const cible = titreDepuisUrl(url);
    if (!cible) return false;
    if (HOTES_MEDIAWIKI.some((r) => r.test(cible.hote))) return true;
    try {
        const r = await fetch(`${cible.base}/api.php?action=query&meta=siteinfo&format=json`, {
            headers: { "user-agent": UA },
            signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return false;
        const j = (await r.json()) as { query?: { general?: { generator?: string } } };
        return /mediawiki/i.test(j.query?.general?.generator ?? "");
    } catch {
        return false;
    }
}

/**
 * Récupère une page de wiki par l'API. Rend `null` si l'URL n'est pas une page de wiki ou si
 * l'API refuse — jamais un objet à moitié vide, qui serait pris pour un succès en aval.
 */
export async function recupererViaMediaWiki(url: string): Promise<PageMediaWiki | null> {
    const cible = titreDepuisUrl(url);
    if (!cible) return null;
    await respecterLeDebit(cible.hote);

    const props = ["text", "wikitext", "sections", "images", "categories", "externallinks", "displaytitle"].join("|");
    const api = `${cible.base}/api.php?action=parse&page=${encodeURIComponent(cible.titre)}&prop=${encodeURIComponent(props)}&formatversion=2&format=json`;

    try {
        const r = await fetch(api, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
        if (!r.ok) return await replirestPhp(cible, url);
        const j = (await r.json()) as any;
        // L'API répond 200 même pour une page absente : l'erreur est DANS le corps.
        if (j.error) return null;
        const p = j.parse;
        if (!p) return null;

        const html: string = p.text ?? "";
        if (html.trim().length < 200) return null;

        return {
            url,
            title: String(p.displaytitle ?? p.title ?? cible.titre).replace(/<[^>]+>/g, ""),
            html,
            markdown: htmlToMarkdown(html),
            wikitext: p.wikitext ?? null,
            sections: (p.sections ?? []).map((s: any) => ({
                niveau: Number(s.level ?? 0),
                titre: String(s.line ?? "").replace(/<[^>]+>/g, ""),
                ancre: String(s.anchor ?? ""),
            })),
            images: p.images ?? [],
            categories: (p.categories ?? []).map((c: any) => (typeof c === "string" ? c : (c.category ?? c["*"] ?? ""))),
            liens_externes: p.externallinks ?? [],
            api: "api.php",
        };
    } catch {
        return await replirestPhp(cible, url);
    }
}

/** Repli sur l'API REST. Utile là où `api.php` est désactivé, bloqué là où Cloudflare filtre. */
async function replirestPhp(cible: { base: string; titre: string; hote: string }, url: string): Promise<PageMediaWiki | null> {
    try {
        await respecterLeDebit(cible.hote);
        const r = await fetch(`${cible.base}/rest.php/v1/page/${encodeURIComponent(cible.titre)}`, {
            headers: { "user-agent": UA },
            signal: AbortSignal.timeout(20_000),
        });
        if (!r.ok) return null;
        const j = (await r.json()) as { title?: string; source?: string };
        const source = j.source ?? "";
        if (source.trim().length < 200) return null;
        return {
            url,
            title: j.title ?? cible.titre,
            html: "",
            // rest.php rend le wikitext brut : pas de HTML à convertir.
            markdown: source,
            wikitext: source,
            sections: [],
            images: [],
            categories: [],
            liens_externes: [],
            api: "rest.php",
        };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Lecture approfondie : ce qu'un wiki publie et qu'un simple Markdown perd
// ---------------------------------------------------------------------------

export type ImageWiki = { fichier: string; url: string; largeur: number | null; hauteur: number | null; mime: string | null };

/**
 * URL en PLEINE résolution des fichiers d'une page.
 *
 * Les URL présentes dans le HTML rendu portent `/scale-to-width-down/<n>/` et un `?cb=…` :
 * les prendre telles quelles, c'est archiver des vignettes. `prop=imageinfo` rend l'original,
 * avec ses dimensions et son type. L'API plafonne à 50 titres par appel, d'où le découpage.
 */
export async function resoudreImages(base: string, fichiers: string[], hote: string): Promise<ImageWiki[]> {
    const out: ImageWiki[] = [];
    for (let i = 0; i < fichiers.length; i += 50) {
        const lot = fichiers.slice(i, i + 50);
        await respecterLeDebit(hote);
        try {
            const u = `${base}/api.php?action=query&titles=${encodeURIComponent(lot.map((f) => (f.startsWith("File:") || f.startsWith("Fichier:") ? f : `File:${f}`)).join("|"))}&prop=imageinfo&iiprop=${encodeURIComponent("url|size|mime")}&formatversion=2&format=json`;
            const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
            if (!r.ok) continue;
            const j = (await r.json()) as any;
            for (const p of j.query?.pages ?? []) {
                const info = p.imageinfo?.[0];
                if (!info?.url) continue;
                out.push({
                    fichier: p.title ?? "",
                    // Défensif : certains wikis renvoient déjà une vignette.
                    url: String(info.url).replace(/\/scale-to-width-down\/\d+/, "").replace(/\?cb=.*$/, ""),
                    largeur: info.width ?? null,
                    hauteur: info.height ?? null,
                    mime: info.mime ?? null,
                });
            }
        } catch {
            /* lot perdu : on continue, un lot manquant vaut mieux qu'un échec total */
        }
    }
    return out;
}

/**
 * Champs de la ou des infobox, lus dans le WIKITEXT et non dans le HTML.
 *
 * Le HTML rendu d'une infobox est une soupe de `<div>` sans noms de champs : les libellés y
 * sont ceux du modèle, traduits, parfois absents. Le wikitext porte les vrais noms
 * (`|name_jp = …`), qui sont stables entre les pages d'un même wiki — c'est ce qui permet de
 * comparer deux personnages, ou de mesurer ce qui nous manque.
 */
export function parserInfobox(wikitext: string): Record<string, { brut: string; propre: string }>[] {
    const boites: Record<string, { brut: string; propre: string }>[] = [];
    // Repérer chaque `{{…Infobox…` et lire jusqu'à sa fermeture, en comptant les accolades :
    // une infobox contient presque toujours d'autres modèles imbriqués.
    const re = /\{\{[^}|\n]*(?:infobox|Infobox|character|Character)[^}|\n]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wikitext)) !== null) {
        let profondeur = 0;
        let fin = m.index;
        for (let i = m.index; i < wikitext.length - 1; i++) {
            if (wikitext.startsWith("{{", i)) profondeur++;
            else if (wikitext.startsWith("}}", i)) {
                profondeur--;
                if (profondeur === 0) {
                    fin = i;
                    break;
                }
            }
        }
        const corps = wikitext.slice(m.index + 2, fin);
        const champs: Record<string, { brut: string; propre: string }> = {};
        // Découper sur les `|` de premier niveau seulement.
        let niveau = 0;
        let courant = "";
        const morceaux: string[] = [];
        for (let i = 0; i < corps.length; i++) {
            if (corps.startsWith("{{", i) || corps.startsWith("[[", i)) niveau++;
            else if (corps.startsWith("}}", i) || corps.startsWith("]]", i)) niveau--;
            if (corps[i] === "|" && niveau <= 0) {
                morceaux.push(courant);
                courant = "";
            } else courant += corps[i];
        }
        morceaux.push(courant);
        for (const morceau of morceaux.slice(1)) {
            const eq = morceau.indexOf("=");
            if (eq < 0) continue;
            const nom = morceau.slice(0, eq).trim();
            const brut = morceau.slice(eq + 1).trim();
            if (!nom || nom.length > 60) continue;
            champs[nom] = { brut, propre: nettoyerWikitexte(brut) };
        }
        if (Object.keys(champs).length) boites.push(champs);
        re.lastIndex = fin;
    }
    return boites;
}

/** Retire le balisage wiki d'une valeur : liens, gras, modèles, commentaires, balises. */
export function nettoyerWikitexte(v: string): string {
    return v
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
        .replace(/\{\{[^{}]*\}\}/g, "")
        .replace(/'''?/g, "")
        .replace(/<br\s*\/?>/gi, " · ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export type TableauWiki = { index: number; titre: string | null; entetes: string[]; lignes: string[][] };

/**
 * Tous les tableaux de données de la page, en lignes et colonnes.
 *
 * `rowspan` et `colspan` sont DÉVELOPPÉS : sans cela une cellule fusionnée décale toutes les
 * colonnes suivantes, et un tableau de statistiques devient illisible sans que rien ne le
 * signale. Le titre associé est le dernier intertitre rencontré avant le tableau.
 */
export function parserTableaux(html: string, $: any): TableauWiki[] {
    const out: TableauWiki[] = [];
    $("table").each((index: number, el: any) => {
        const $t = $(el);
        const grille: string[][] = [];
        // (ligne, colonne) -> texte, pour poser les cellules fusionnées à leur vraie place.
        const enAttente: Record<string, string> = {};
        $t.find("tr").each((r: number, tr: any) => {
            const ligne: string[] = [];
            let c = 0;
            const poser = () => {
                while (enAttente[`${r},${c}`] !== undefined) {
                    ligne[c] = enAttente[`${r},${c}`]!;
                    c++;
                }
            };
            poser();
            $(tr)
                .find("th,td")
                .each((_: number, cell: any) => {
                    const texte = $(cell).text().replace(/\s+/g, " ").trim();
                    const cs = Math.max(1, Number.parseInt($(cell).attr("colspan") ?? "1", 10) || 1);
                    const rs = Math.max(1, Number.parseInt($(cell).attr("rowspan") ?? "1", 10) || 1);
                    for (let i = 0; i < cs; i++) {
                        ligne[c] = texte;
                        for (let j = 1; j < rs; j++) enAttente[`${r + j},${c}`] = texte;
                        c++;
                        poser();
                    }
                });
            if (ligne.length) grille.push(ligne.map((x) => x ?? ""));
        });
        if (!grille.length) return;
        const titre = $t.prevAll("h2,h3,h4").first().text().replace(/\s+/g, " ").trim() || null;
        // Première ligne = en-têtes si elle n'est faite que de <th>.
        const premiere = $t.find("tr").first();
        const entetes = premiere.find("th").length > 0 && premiere.find("td").length === 0 ? (grille.shift() ?? []) : [];
        out.push({ index, titre, entetes, lignes: grille });
    });
    return out;
}

/** Recherche plein texte sur le wiki. Rend les titres, pas les extraits : l'appelant décide. */
export async function rechercher(base: string, requete: string, hote: string, limite = 20): Promise<{ titre: string; url: string; taille: number | null }[]> {
    await respecterLeDebit(hote);
    const u = `${base}/api.php?action=query&list=search&srsearch=${encodeURIComponent(requete)}&srlimit=${limite}&formatversion=2&format=json`;
    try {
        const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) return [];
        const j = (await r.json()) as any;
        return (j.query?.search ?? []).map((s: any) => ({
            titre: s.title,
            url: `${base}/wiki/${encodeURIComponent(String(s.title).replace(/ /g, "_"))}`,
            taille: s.size ?? null,
        }));
    } catch {
        return [];
    }
}
