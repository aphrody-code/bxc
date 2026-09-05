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
 *
 * Ce module ne fait QUE parler à l'API et découper ce qu'elle rend. Les capacités composées
 * (dossier complet, miroir sur disque, recherche locale) vivent dans `wiki-service.ts`, pour
 * que la CLI et le serveur MCP les partagent sans dupliquer une ligne.
 */

import { htmlToMarkdown } from "../internal/html-utils.ts";

/** Hôtes dont on sait qu'ils servent MediaWiki : on passe par l'API sans même sonder. */
const HOTES_MEDIAWIKI = [/\.fandom\.com$/i, /\.wikipedia\.org$/i, /\.wikimedia\.org$/i, /\.miraheze\.org$/i, /\.wiki\.gg$/i, /\.fextralife\.com$/i];

const UA = "bxc/0.9 (+https://github.com/aphrody-dev/bxc; MediaWiki API client)";

/**
 * Réglages de transport communs à tous les appels du module.
 *
 * `proxy` et `tls` sont des options NATIVES du `fetch` de Bun (Node n'en a aucune sans
 * `undici`) : sans elles, `smartFetch` savait franchir un proxy d'entreprise avec ses profils
 * navigateur et échouait sur le repli MediaWiki, ce qui rendait le repli inutile là où il
 * était justement le plus utile. Vérifié le 2026-09-05 : `fetch(url, { proxy: "http://127.0.0.1:9" })`
 * échoue en « Unable to connect », donc l'option est bien honorée et non ignorée.
 */
export type OptionsMediaWiki = {
    /** Proxy HTTP/HTTPS/SOCKS traversé par toutes les requêtes. */
    proxy?: string;
    /** Accepter un certificat TLS invalide (équivalent de `--insecure`). */
    insecure?: boolean;
    /** Délai maximal d'UNE tentative, en millisecondes. */
    timeoutMs?: number;
    /** Trace libcurl sur stderr. Se pose aussi par `BXC_VERBOSE=1`. */
    verbose?: boolean;
};

/**
 * Fandom recommande de rester sous ~10 requêtes/minute. On tient un intervalle minimal par
 * hôte : sans cela, un crawl un peu large se fait bannir et l'API rejoint le HTML côté 403.
 */
export const INTERVALLE_MIN_MS = 6_000;

/** Instant (epoch ms) à partir duquel l'hôte accepte une requête de plus. */
const prochainCreneau = new Map<string, number>();

/**
 * Réserve le prochain créneau d'un hôte et rend l'attente à observer, en millisecondes.
 *
 * La réservation est SYNCHRONE, et c'est tout l'intérêt. L'ancienne forme lisait la date du
 * dernier appel, dormait, puis l'écrivait : N appels concurrents lisaient donc la MÊME date,
 * dormaient le MÊME temps et repartaient tous ensemble — le limiteur ne limitait rien dès
 * qu'on l'utilisait en parallèle, ce que fait `wiki page` (images et tableaux de front).
 * En réservant avant d'attendre, trois appels simultanés obtiennent 0, 6 000 et 12 000 ms.
 *
 * Exporté pour être testable sans réseau et sans attendre : c'est une fonction pure de
 * `(hôte, intervalle, maintenant)` vers une durée.
 */
export function reserverCreneau(hote: string, intervalleMs: number = INTERVALLE_MIN_MS, maintenant: number = Date.now()): number {
    const creneau = Math.max(maintenant, prochainCreneau.get(hote) ?? 0);
    prochainCreneau.set(hote, creneau + intervalleMs);
    return creneau - maintenant;
}

/** Oublie les créneaux réservés (un hôte, ou tous). Sert aux tests et aux processus longs. */
export function reinitialiserDebit(hote?: string): void {
    if (hote) prochainCreneau.delete(hote);
    else prochainCreneau.clear();
}

async function respecterLeDebit(hote: string): Promise<void> {
    const attente = reserverCreneau(hote);
    if (attente > 0) await Bun.sleep(attente);
}

// ---------------------------------------------------------------------------
// Transport : une seule porte, avec reprise
// ---------------------------------------------------------------------------

/**
 * Codes sur lesquels réessayer. 429 et 503 sont ceux que MediaWiki rend quand il throttle,
 * et il les accompagne d'un `Retry-After` qu'il serait absurde d'ignorer pour le remplacer
 * par une constante devinée.
 */
const CODES_REESSAYABLES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

function initFetch(opts: OptionsMediaWiki | undefined, timeoutMs: number, accept: string): RequestInit {
    const init: Record<string, unknown> = {
        headers: { "user-agent": UA, accept },
        // Un signal FRAIS par tentative : réutiliser celui de la tentative précédente ferait
        // avorter la reprise avant même qu'elle parte.
        signal: AbortSignal.timeout(timeoutMs),
    };
    if (opts?.proxy) init.proxy = opts.proxy;
    if (opts?.insecure) init.tls = { rejectUnauthorized: false };
    if (opts?.verbose ?? Bun.env.BXC_VERBOSE === "1") init.verbose = true;
    return init as RequestInit;
}

/** Requête avec reprise sur 429/5xx, honorant `Retry-After`. Rend `null` si tout a échoué. */
async function fetchAvecReprise(u: string, opts: OptionsMediaWiki | undefined, timeoutMs: number, accept = "application/json", tentatives = 3): Promise<Response | null> {
    for (let n = 0; n < tentatives; n++) {
        try {
            const r = await fetch(u, initFetch(opts, timeoutMs, accept));
            if (r.ok || !CODES_REESSAYABLES.has(r.status) || n === tentatives - 1) return r;
            const entete = Number.parseInt(r.headers.get("retry-after") ?? "", 10);
            const attente = Number.isFinite(entete) && entete > 0 ? Math.min(entete * 1000, 60_000) : 1_000 * 2 ** n;
            // Libérer la connexion : un corps non lu garde la socket occupée.
            try {
                await r.body?.cancel();
            } catch {
                /* corps déjà consommé ou absent */
            }
            await Bun.sleep(attente);
        } catch {
            if (n === tentatives - 1) return null;
            await Bun.sleep(1_000 * 2 ** n);
        }
    }
    return null;
}

/** Requête d'API rendant le JSON décodé, ou `null` (réseau, code d'erreur, corps illisible). */
async function apiJson(u: string, opts: OptionsMediaWiki | undefined, timeoutMs: number): Promise<Record<string, any> | null> {
    const r = await fetchAvecReprise(u, opts, timeoutMs);
    if (!r || !r.ok) return null;
    try {
        return (await r.json()) as Record<string, any>;
    } catch {
        return null;
    }
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
    /** Révision servie. Sans elle, rien de ce qu'on archive n'est citable ni réconciliable. */
    revid: number | null;
};

/** Le chemin `/wiki/<Titre>` d'un wiki, ou null si l'URL n'y ressemble pas. */
export function titreDepuisUrl(url: string): { base: string; titre: string; hote: string } | null {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    // /wiki/Titre, /<lang>/wiki/Titre (Fandom localisé), /index.php?title=Titre.
    // Le préfixe accepte la forme régionale : Fandom sert `pt-br`, `zh-tw`, `es-419`, que
    // `[a-z]{2,3}` seul laissait tomber — l'URL partait alors sur le wiki anglais.
    const m = u.pathname.match(/^(?:\/([a-z]{2,3}(?:-[a-z0-9]{2,8})?))?\/wiki\/(.+)$/i);
    let base: string;
    let brut: string;
    if (m?.[2]) {
        // Le préfixe de langue fait partie de la base de l'API : /fr/api.php, pas /api.php.
        base = `${u.origin}${m[1] ? `/${m[1]}` : ""}`;
        brut = m[2];
    } else {
        const q = u.searchParams.get("title");
        if (!q) return null;
        // `/w/index.php?title=X` : l'API est `/w/api.php`, pas `/api.php`. Prendre le
        // RÉPERTOIRE du script d'entrée, sinon toutes les requêtes visent une base qui
        // n'existe pas — l'installation MediaWiki la plus courante hors Fandom.
        base = `${u.origin}${u.pathname.replace(/\/[^/]*$/, "")}`;
        brut = q;
    }

    // `decodeURIComponent` LÈVE sur un `%` littéral (vérifié : `100%_Orange` → URIError), et
    // cette exception traversait la fonction au lieu du `null` que ses appelants attendent.
    let titre: string;
    try {
        titre = decodeURIComponent(brut);
    } catch {
        titre = brut;
    }
    // Dans un titre MediaWiki, `_` EST l'espace : les normaliser rend le titre affichable et
    // ne change rien pour l'API, qui accepte les deux formes.
    titre = titre.replace(/_/g, " ").trim();
    if (!titre) return null;
    return { base, titre, hote: u.host };
}

/**
 * Sondes `meta=siteinfo` déjà effectuées, mémorisées PAR PROMESSE.
 *
 * Mémoriser la promesse et non le résultat sérialise aussi les sondes concurrentes : un crawl
 * de 200 pages d'un même wiki inconnu déclenchait 200 requêtes réseau identiques de 8 s.
 */
const sondesMediaWiki = new Map<string, Promise<boolean>>();

/** Ce domaine sert-il MediaWiki ? Connu d'avance, ou sondé via `meta=siteinfo`. */
export async function estMediaWiki(url: string, opts?: OptionsMediaWiki): Promise<boolean> {
    const cible = titreDepuisUrl(url);
    if (!cible) return false;
    // Le port ne doit pas entrer dans la comparaison : `example.wikipedia.org:8443` n'est pas
    // moins un wiki, et `u.host` le porte.
    const hoteSansPort = cible.hote.replace(/:\d+$/, "");
    if (HOTES_MEDIAWIKI.some((r) => r.test(hoteSansPort))) return true;

    const memo = sondesMediaWiki.get(cible.base);
    if (memo) return await memo;
    const sonde = (async () => {
        // La sonde consomme aussi un créneau : sans cela elle partait hors limiteur, puis
        // `recupererViaMediaWiki` trouvait la table vide et tirait immédiatement — deux
        // requêtes coup sur coup sur un hôte qu'on prétendait ménager.
        await respecterLeDebit(cible.hote);
        const j = await apiJson(`${cible.base}/api.php?action=query&meta=siteinfo&format=json&formatversion=2`, opts, opts?.timeoutMs ?? 8_000);
        return /mediawiki/i.test(String(j?.query?.general?.generator ?? ""));
    })();
    sondesMediaWiki.set(cible.base, sonde);
    return await sonde;
}

/**
 * Récupère une page de wiki par l'API. Rend `null` si l'URL n'est pas une page de wiki ou si
 * l'API refuse — jamais un objet à moitié vide, qui serait pris pour un succès en aval.
 */
export async function recupererViaMediaWiki(url: string, opts?: OptionsMediaWiki): Promise<PageMediaWiki | null> {
    const cible = titreDepuisUrl(url);
    if (!cible) return null;
    await respecterLeDebit(cible.hote);

    const props = ["text", "wikitext", "sections", "images", "categories", "externallinks", "displaytitle", "revid"].join("|");
    // `redirects=1` n'est PAS un détail. Mesuré le 2026-09-05 sur /wiki/Aphrodi, une
    // redirection vers Afuro Terumi : sans lui l'API rend 1 010 o (le pied de page du
    // renvoi), avec lui 519 579 o — soit 514 fois plus. Et comme 1 010 o passent la garde
    // des 200 caractères, l'ancien code servait ce moignon comme un succès. Toute page
    // atteinte par un alias, un nom traduit ou une majuscule différente était concernée.
    const api = `${cible.base}/api.php?action=parse&page=${encodeURIComponent(cible.titre)}&prop=${encodeURIComponent(props)}&redirects=1&formatversion=2&format=json`;

    const j = await apiJson(api, opts, opts?.timeoutMs ?? 30_000);
    // L'API répond 200 même pour une page absente : l'erreur est DANS le corps.
    if (j && !j.error && j.parse) {
        const p = j.parse;
        const html: string = p.text ?? "";
        if (html.trim().length >= 200) {
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
                revid: Number.isFinite(Number(p.revid)) ? Number(p.revid) : null,
            };
        }
    }
    // Page manquante (`missingtitle`) : inutile de redemander la même chose à `rest.php`.
    if (j?.error?.code === "missingtitle" || j?.error?.code === "invalidtitle") return null;
    return await replirestPhp(cible, url, opts);
}

/** Repli sur l'API REST. Utile là où `api.php` est désactivé, bloqué là où Cloudflare filtre. */
async function replirestPhp(cible: { base: string; titre: string; hote: string }, url: string, opts?: OptionsMediaWiki): Promise<PageMediaWiki | null> {
    await respecterLeDebit(cible.hote);
    const j = (await apiJson(`${cible.base}/rest.php/v1/page/${encodeURIComponent(cible.titre)}`, opts, opts?.timeoutMs ?? 20_000)) as {
        title?: string;
        source?: string;
        latest?: { id?: number };
    } | null;
    const source = j?.source ?? "";
    if (source.trim().length < 200) return null;
    return {
        url,
        title: j?.title ?? cible.titre,
        html: "",
        // rest.php rend le wikitext brut : pas de HTML à convertir.
        markdown: source,
        wikitext: source,
        sections: [],
        images: [],
        categories: [],
        liens_externes: [],
        api: "rest.php",
        revid: Number.isFinite(Number(j?.latest?.id)) ? Number(j?.latest?.id) : null,
    };
}

// ---------------------------------------------------------------------------
// Lecture approfondie : ce qu'un wiki publie et qu'un simple Markdown perd
// ---------------------------------------------------------------------------

export type ImageWiki = {
    fichier: string;
    url: string;
    largeur: number | null;
    hauteur: number | null;
    mime: string | null;
    /** SHA-1 publié par le wiki : de quoi vérifier un téléchargement au lieu de l'espérer. */
    sha1: string | null;
};

/** Espaces de noms « Fichier » des langues qu'on croise le plus. */
const NS_FICHIER = /^(File|Fichier|Image|Datei|Archivo|Ficheiro|Immagine|ファイル|Файл|Bestand|Fil|Plik):/i;

/**
 * URL en PLEINE résolution des fichiers d'une page.
 *
 * Les URL présentes dans le HTML rendu portent `/scale-to-width-down/<n>/` et un `?cb=…` :
 * les prendre telles quelles, c'est archiver des vignettes. `prop=imageinfo` rend l'original,
 * avec ses dimensions, son type et son SHA-1. L'API plafonne à 50 titres par appel, d'où le
 * découpage.
 */
export async function resoudreImages(base: string, fichiers: string[], hote: string, opts?: OptionsMediaWiki): Promise<ImageWiki[]> {
    const out: ImageWiki[] = [];
    for (let i = 0; i < fichiers.length; i += 50) {
        const lot = fichiers.slice(i, i + 50);
        await respecterLeDebit(hote);
        const titres = lot.map((f) => (NS_FICHIER.test(f) ? f : `File:${f}`)).join("|");
        const u = `${base}/api.php?action=query&titles=${encodeURIComponent(titres)}&prop=imageinfo&iiprop=${encodeURIComponent("url|size|mime|sha1")}&formatversion=2&format=json`;
        const j = await apiJson(u, opts, opts?.timeoutMs ?? 30_000);
        // Un lot perdu vaut mieux qu'un échec total : on continue avec les suivants.
        if (!j) continue;
        for (const p of j.query?.pages ?? []) {
            const info = p.imageinfo?.[0];
            if (!info?.url) continue;
            out.push({
                fichier: p.title ?? "",
                // Retirer la VIGNETTE (`/scale-to-width-down/<n>`) pour obtenir l'original,
                // mais SURTOUT PAS la query string : sur un wiki localisé, elle porte
                // `path-prefix=fr`, sans lequel le CDN cherche le fichier sur le wiki
                // anglais et rend 404. Mesuré : en la supprimant, 33 des 34 images d'une
                // page FR échouaient, dont une qui réussissait — celle qui existe aussi
                // sur le wiki anglais. Le `cb=` est un cache-buster inoffensif.
                url: String(info.url).replace(/\/scale-to-width-down\/\d+/, ""),
                largeur: info.width ?? null,
                hauteur: info.height ?? null,
                mime: info.mime ?? null,
                sha1: typeof info.sha1 === "string" ? info.sha1 : null,
            });
        }
    }
    return out;
}

/** Télécharge un fichier du wiki. Rend la réponse brute : l'appelant décide où la poser. */
export async function telechargerFichier(url: string, opts?: OptionsMediaWiki): Promise<Response | null> {
    const r = await fetchAvecReprise(url, opts, opts?.timeoutMs ?? 60_000, "*/*");
    return r?.ok ? r : null;
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
    const re = /\{\{[^}|\n]*(?:infobox|character)[^}|\n]*/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wikitext)) !== null) {
        const depart = m.index;
        const fin = finDuModele(wikitext, depart);
        // AVANCER TOUJOURS. L'ancienne version reposait `re.lastIndex` sur `m.index` quand la
        // fermeture manquait : `exec` rematchait alors au même endroit, indéfiniment. Mesuré
        // sur `"{{Infobox character\n|name = Aphrodi\n"` — le processus ne rendait jamais la
        // main (tué à 10 s). Une page tronquée ou un `{{` dans un `<nowiki>` suffisait.
        re.lastIndex = fin > depart ? fin : depart + 2;
        if (fin < 0) continue;

        const corps = wikitext.slice(depart + 2, fin - 2);
        const champs: Record<string, { brut: string; propre: string }> = {};
        // On saute le premier morceau : c'est le nom du modèle, pas un champ.
        for (const morceau of decouperParametres(corps).slice(1)) {
            const eq = morceau.indexOf("=");
            if (eq < 0) continue;
            const nom = morceau.slice(0, eq).trim();
            const brut = morceau.slice(eq + 1).trim();
            // Un vrai nom de paramètre ne contient ni balisage ni saut de ligne. Sans ce
            // filtre, un paramètre positionnel du genre `|[[a|b=c]]` créait un champ nommé
            // « [[a|b ».
            if (!nom || nom.length > 60 || /[[\]{}<>\n|]/.test(nom)) continue;
            champs[nom] = { brut, propre: nettoyerWikitexte(brut) };
        }
        if (Object.keys(champs).length) boites.push(champs);
    }
    return boites;
}

/**
 * Index de fin (exclusif) du `}}` fermant le modèle ouvert en `depart`, ou -1 s'il n'existe
 * pas. Le curseur saute les DEUX caractères d'un délimiteur : sans cela `{{{param}}}` se
 * comptait de travers dès qu'il côtoyait un modèle ordinaire.
 */
function finDuModele(s: string, depart: number): number {
    let profondeur = 0;
    for (let i = depart; i < s.length - 1; i++) {
        if (s[i] === "{" && s[i + 1] === "{") {
            profondeur++;
            i++;
        } else if (s[i] === "}" && s[i + 1] === "}") {
            profondeur--;
            i++;
            if (profondeur === 0) return i + 1;
        }
    }
    return -1;
}

/**
 * Découpe le corps d'un modèle sur ses `|` de PREMIER niveau.
 *
 * Les modèles (`{{…}}`) et les liens (`[[…]]`) imbriqués sont traversés : le `|` d'un
 * `[[Cible|Libellé]]` à l'intérieur d'un champ n'est pas un séparateur de champ.
 * Volontairement, on ne traite PAS les tableaux wiki (`{|` … `|}`) : leur délimiteur de
 * fermeture `|}` est indiscernable du `|}}` d'un paramètre vide (`{{Modèle|}}`), autrement
 * plus fréquent, et le prendre en compte dérèglerait la profondeur sur le cas courant.
 */
function decouperParametres(corps: string): string[] {
    const morceaux: string[] = [];
    let niveau = 0;
    let debut = 0;
    for (let i = 0; i < corps.length; i++) {
        const a = corps[i];
        const b = corps[i + 1];
        if ((a === "{" && b === "{") || (a === "[" && b === "[")) {
            niveau++;
            i++;
        } else if ((a === "}" && b === "}") || (a === "]" && b === "]")) {
            if (niveau > 0) niveau--;
            i++;
        } else if (a === "|" && niveau === 0) {
            morceaux.push(corps.slice(debut, i));
            debut = i + 1;
        }
    }
    morceaux.push(corps.slice(debut));
    return morceaux;
}

/** Entités HTML qu'on croise dans les infobox. Bun n'expose pas l'inverse de `escapeHTML`. */
const ENTITES: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    times: "×",
    deg: "°",
};

/** Retire le balisage wiki d'une valeur : liens, gras, modèles, commentaires, balises. */
export function nettoyerWikitexte(v: string): string {
    let s = v
        .replace(/<!--[\s\S]*?-->/g, "")
        // Le contenu d'une note de bas de page n'est pas la valeur du champ : l'ancienne
        // version n'ôtait que les BALISES `<ref>` et laissait la note collée à la valeur.
        .replace(/<ref[^>]*\/>/gi, "")
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");

    // Liens internes, du plus imbriqué vers l'extérieur. MediaWiki affiche le DERNIER
    // segment : le libellé d'un `[[Cible|Libellé]]`, la légende d'un `[[File:x|thumb|Légende]]`.
    // L'ancienne forme ne coupait qu'au premier `|` et rendait « thumb|200px|Légende ».
    for (let i = 0; i < 8; i++) {
        const avant = s;
        s = s.replace(/\[\[([^[\]]*)\]\]/g, (_, dedans: string) => {
            const parts = dedans.split("|");
            return (parts[parts.length - 1] ?? "").trim();
        });
        if (s === avant) break;
    }
    // Liens externes : `[url libellé]` → libellé, `[url]` → url.
    s = s.replace(/\[(https?:\/\/\S+?)(?:\s+([^\]]*))?\]/g, (_, u: string, l?: string) => (l && l.trim() ? l : u));

    // Modèles, du plus imbriqué vers l'extérieur : une passe unique laissait `{{a|}}` derrière
    // elle sur `{{a|{{b}}}}`, c'est-à-dire du balisage dans une valeur dite « propre ».
    for (let i = 0; i < 8; i++) {
        const avant = s;
        s = s.replace(/\{\{[^{}]*\}\}/g, "");
        if (s === avant) break;
    }

    return s
        .replace(/'''?/g, "")
        .replace(/<br\s*\/?>/gi, " · ")
        .replace(/<[^>]+>/g, "")
        .replace(/&([a-z]+);/gi, (tout, e: string) => ENTITES[e.toLowerCase()] ?? tout)
        .replace(/&#(\d+);/g, (tout, n: string) => {
            const c = Number(n);
            return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : tout;
        })
        .replace(/&#x([0-9a-f]+);/gi, (tout, n: string) => {
            const c = Number.parseInt(n, 16);
            return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : tout;
        })
        .replace(/\s+/g, " ")
        .trim();
}

export type TableauWiki = { index: number; titre: string | null; entetes: string[]; lignes: string[][] };

/**
 * Tous les tableaux de données de la page, en lignes et colonnes.
 *
 * `rowspan` et `colspan` sont DÉVELOPPÉS : sans cela une cellule fusionnée décale toutes les
 * colonnes suivantes, et un tableau de statistiques devient illisible sans que rien ne le
 * signale.
 *
 * Le paramètre `html` n'est plus lu (le document est déjà chargé dans `$`) ; il reste dans la
 * signature parce que des appelants le passent.
 */
export function parserTableaux(_html: string, $: any): TableauWiki[] {
    const out: TableauWiki[] = [];
    $("table").each((index: number, el: any) => {
        const $t = $(el);
        // `find("tr")` est une recherche de DESCENDANTS : sur un tableau qui en contient un
        // autre — cas ordinaire sur Fandom — le tableau extérieur absorbait les lignes du
        // tableau intérieur. Mesuré sur un cas à deux niveaux : 4 lignes rendues au lieu de 2,
        // dont deux doublons du tableau interne. On ne garde que les lignes dont le `<table>`
        // le plus proche est celui qu'on traite.
        const lignesPropres = $t.find("tr").filter((_: number, tr: any) => $(tr).closest("table").get(0) === el);

        const grille: string[][] = [];
        // (ligne, colonne) -> texte, pour poser les cellules fusionnées à leur vraie place.
        const enAttente: Record<string, string> = {};
        lignesPropres.each((r: number, tr: any) => {
            const ligne: string[] = [];
            let c = 0;
            const poser = () => {
                while (enAttente[`${r},${c}`] !== undefined) {
                    ligne[c] = enAttente[`${r},${c}`]!;
                    c++;
                }
            };
            poser();
            // `children` et non `find` : les cellules d'un tableau imbriqué appartiennent à
            // leur propre `<tr>`, pas à celui-ci.
            $(tr)
                .children("th,td")
                .each((_: number, cell: any) => {
                    const texte = texteDeCellule($, cell);
                    const cs = Math.max(1, Number.parseInt($(cell).attr("colspan") ?? "1", 10) || 1);
                    const rs = Math.max(1, Number.parseInt($(cell).attr("rowspan") ?? "1", 10) || 1);
                    for (let i = 0; i < cs; i++) {
                        ligne[c] = texte;
                        for (let j = 1; j < rs; j++) enAttente[`${r + j},${c}`] = texte;
                        c++;
                        poser();
                    }
                });
            if (ligne.length) grille.push(Array.from(ligne, (x) => x ?? ""));
        });
        if (!grille.length) return;

        // Première ligne = en-têtes si elle n'est faite que de <th>.
        const premiere = lignesPropres.first();
        const entetes = premiere.children("th").length > 0 && premiere.children("td").length === 0 ? (grille.shift() ?? []) : [];
        out.push({ index, titre: titreDuTableau($, el), entetes, lignes: grille });
    });
    return out;
}

/**
 * Texte d'une cellule. `.text()` seul COLLE les fragments séparés par un `<br>` :
 * `<td>Zeus<br>Japon</td>` rendait « ZeusJapon », soit deux valeurs fusionnées en un mot
 * inexistant. On travaille sur un clone pour ne pas modifier le document de l'appelant.
 */
function texteDeCellule($: any, cell: any): string {
    const c = $(cell).clone();
    c.find("sup.reference, style, script").remove();
    c.find("br").replaceWith(" · ");
    // Même symptôme pour une cellule qui contient un tableau : `.text()` recolle « interne »
    // et « x » en « internex ». On sépare les cellules imbriquées avant d'aplatir.
    c.find("td,th").after(" ");
    return c.text().replace(/\s+/g, " ").trim();
}

/**
 * Titre d'un tableau : sa `<caption>` d'abord (c'est le titre que le wiki lui a donné), sinon
 * l'intertitre qui le précède. `prevAll` ne regarde que les FRÈRES : sur les pages où le
 * tableau est enveloppé dans un `<div>`, aucun titre n'était trouvé. On remonte donc les
 * ancêtres. `.mw-heading` est le conteneur des titres du rendu MediaWiki récent.
 */
function titreDuTableau($: any, el: any): string | null {
    const legende = $(el).children("caption").first().text().replace(/\s+/g, " ").trim();
    if (legende) return legende;
    let n = $(el);
    for (let i = 0; i < 6 && n.length; i++) {
        const $h = n.prevAll("h1,h2,h3,h4,h5,h6,.mw-heading").first();
        if ($h.length) {
            const c = $h.clone();
            c.find(".mw-editsection").remove();
            const t = c.text().replace(/\s+/g, " ").trim();
            if (t) return t;
        }
        n = n.parent();
    }
    return null;
}

/** Recherche plein texte sur le wiki. Rend les titres, pas les extraits : l'appelant décide. */
export async function rechercher(base: string, requete: string, hote: string, limite = 20, opts?: OptionsMediaWiki): Promise<{ titre: string; url: string; taille: number | null }[]> {
    await respecterLeDebit(hote);
    const u = `${base}/api.php?action=query&list=search&srsearch=${encodeURIComponent(requete)}&srlimit=${limite}&formatversion=2&format=json`;
    const j = await apiJson(u, opts, opts?.timeoutMs ?? 20_000);
    return (j?.query?.search ?? []).map((s: any) => ({
        titre: s.title,
        url: `${base}/wiki/${encodeURIComponent(String(s.title).replace(/ /g, "_"))}`,
        taille: s.size ?? null,
    }));
}
