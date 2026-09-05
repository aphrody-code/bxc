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
