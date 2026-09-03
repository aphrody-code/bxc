# @aphrody/animesama

Scraper typé pour **[anime-sama.to](https://anime-sama.to)** : catalogue,
saisons, langues, épisodes et résolution des lecteurs vers un flux direct.

Extraction **purement textuelle** — pas de DOM, pas d'exécution de JS. Le module
analyse le HTML rendu côté serveur et les fichiers `episodes.js`, donc il
fonctionne aussi bien sur un miroir persisté que sur une réponse live. Le
transport HTTP est **injectable**, ce qui rend l'ensemble testable sans réseau.

- Code : `packages/animesama/src/index.ts`
- Tests (sans réseau) : `packages/animesama/src/index.test.ts`
- Fixtures réelles : `packages/animesama/test/fixtures/`

## Anatomie du site (rétro-ingénierie du 2026-09-03)

| Ressource | Chemin | Contenu |
| --- | --- | --- |
| Fiche d'une œuvre | `/catalogue/<slug>/` | titre, titres alternatifs, synopsis, genres, état, année, studios — et les saisons **en JavaScript** |
| Page de saison | `/catalogue/<slug>/<saison>/<langue>/` | titre, sélecteurs, et le script qui compose les libellés d'épisodes |
| Lecteurs | `/catalogue/<slug>/<saison>/<langue>/episodes.js` | une variable `epsN` par lecteur, une case par épisode |
| Recherche instantanée | `POST /template-php/defaut/fetch.php` (`query=<texte>`) | fragment de `<a class="asn-search-result">` |
| Catalogue paginé | `GET /catalogue/?search=<texte>&page=N` | cartes `.catalog-card` |

Quatre pièges que le module absorbe :

1. **Les saisons ne sont pas du HTML.** Elles sont écrites par des appels
   `panneauAnime("Saison 1", "saison1/vf")` (et `panneauScan(…)` pour les scans)
   exécutés via `document.write`. C'est la seule source de vérité.
2. **`episodes.js` n'a pas de forme canonique.** On croise `var eps2` déclaré
   avant `var eps1`, `eps1` absent, une déclaration entière sur une seule ligne,
   des virgules traînantes. `videos.js` **échange** ensuite `eps1` et `eps2` à
   l'affichage ; ce module conserve la numérotation brute du fichier
   (`Lecteur.index`) et nomme les lecteurs dans l'ordre croissant (`Lecteur.nom`).
3. **Les libellés d'épisodes sont calculés.** La page appelle `resetListe()`,
   `creerListe(debut, fin)`, `newSP(n)`, `newSPF("nom libre")`, `finirListe(debut)`.
   Le dernier `resetListe()` gagne : le bloc par défaut est souvent suivi d'un
   second bloc (films). Un gabarit **commenté** contient les mêmes appels — les
   commentaires sont retirés avant analyse, sans casser les `//` des URLs.
4. **Les drapeaux de langue ne disent rien.** Le gabarit imprime les dix
   drapeaux, tous `hidden` ; c'est `videos.js` qui sonde `../<langue>` en HTTP
   pour révéler ceux qui existent. Seul `listerLangues()` dit la vérité.

### Hébergeurs rencontrés

`ansembed.net`, `lpayer.embed4me.com`, `video.sibnet.ru`, `sendvid.com`,
`movearnpre.com`, `oneupload.to`, `s22.anime-sama.fr` (mp4 direct),
`www.youtube.com/embed`, `www.dailymotion.com/embed`, `vidmoly`, `myvi.top`.

## CLI

```bash
bxc animesama search <requête>        # recherche instantanée (POST fetch.php)
bxc animesama info <slug|url>         # fiche + saisons déclarées
bxc animesama seasons <slug>          # saisons + langues réellement publiées
bxc animesama episodes <slug>         # épisodes d'une saison (--season/--lang)
bxc animesama resolve <url-embed>     # embed → flux direct (+ variantes HLS)
```

Options : `--season <dossier>` (défaut `saison1`, accepte `film`, `oav`…),
`--lang <code>` (`vostfr` par défaut ; `vf`, `va`, `var`, `vkr`, `vcn`, `vqc`,
`vf1`, `vf2`), `--profile static|fast|http|stealth|max` (défaut `static`),
`--timeout <ms>`.

```bash
$ bxc animesama search inazuma
[{ "slug": "inazuma-eleven", "titre": "Inazuma Eleven", … }]

$ bxc animesama seasons inazuma-eleven
{ "slug": "inazuma-eleven", "saisons": [{ "saison": "saison1", "noms": ["Saison 1"], "langues": ["vf"] }, …] }

$ bxc animesama episodes inazuma-eleven --season saison1 --lang vf
{ "titre": "Inazuma Eleven", "libelle": "Saison 1", "lecteurs": [ … ], "episodes": [ … ] }

$ bxc animesama resolve "https://video.sibnet.ru/shell.php?videoid=4826196"
{ "hebergeur": "sibnet", "type": "mp4", "url": "https://video.sibnet.ru/v/…/4826196.mp4" }
```

## API

```ts
import { AnimesamaScraper } from "@aphrody/animesama";

const as = new AnimesamaScraper();               // profile "static" par défaut

const resultats = await as.rechercher("inazuma");
const fiche = await as.getAnime("inazuma-eleven");
console.log(fiche.titre, fiche.saisons.map((s) => s.nom));

const langues = await as.listerLangues("inazuma-eleven", "saison1");  // ["vf"]

const saison = await as.getSaison("inazuma-eleven", "saison1", "vf");
console.log(saison.episodes.length);             // 26
console.log(saison.episodes[0].lecteurs);        // [{ hebergeur: "youtube", … }, …]

const source = await as.resoudreLecteur(saison.episodes[0].lecteurs[1], {
  enumererQualites: true,
});
console.log(source.type, source.url, source.enTetes.Referer);

await as.close();
```

### Surface exportée

| Symbole | Rôle |
| --- | --- |
| `AnimesamaScraper` | client haut niveau (défaut du module) |
| `AnimesamaOptions` | `profile`, `baseUrl`, `timeoutMs`, `retries`, `transport` |
| `rechercher` / `parcourirCatalogue` | recherche instantanée / catalogue paginé |
| `getAnime` / `getAnimeComplet` | fiche seule / fiche + toutes ses saisons |
| `getSaison` / `getEpisodesJs` / `listerLangues` | une saison, son `episodes.js` brut, ses langues sondées |
| `resoudreLecteur` / `enumererQualitesHls` | embed → flux direct, variantes d'un master HLS |
| `parserFicheAnime`, `parserSaisonsDeclarees`, `parserLecteurs`, `parserNomsEpisodes`, `parserSaison`, `parserResultatsRecherche`, `parserCartesCatalogue`, `parserDrapeauxLangues`, `composerEpisodes` | analyseurs **purs** (chaîne → objets), utilisables sur un miroir |
| `hebergeurDepuisUrl`, `normaliserUrlLecteur`, `chercherMedia`, `classerMedia`, `deballerPacker`, `numeroDepuisNom`, `estLangue`, `texteBrut`, `retirerCommentairesJs` | utilitaires |
| `FicheAnime`, `SaisonRef`, `SaisonAnimesama`, `EpisodeAnimesama`, `Lecteur`, `LecteurEpisode`, `SourceResolue`, `QualiteMedia`, `ResultatRecherche`, `LangueAnimesama`, `LANGUES_ANIMESAMA` | types publics |

### Transport injectable

`AnimesamaScraper` n'ouvre une page bxc que si aucun `transport` n'est fourni.
En injecter un permet de brancher un cache, un miroir — ou des fixtures :

```ts
const scraper = new AnimesamaScraper({
  transport: async ({ url }) => ({ status: 200, corps: htmlDeFixture[url] }),
});
```

Le transport par défaut (`creerTransportBxc`) fait les `GET` via une page bxc
(`profile`, `static` = zéro spawn) et le seul `POST` — la recherche — via `fetch`,
puisque `page.goto()` n'envoie pas de corps.

## Tests

```bash
bun test packages/animesama          # 47 cas, aucun accès réseau
```

Les fixtures de `test/fixtures/` sont des extraits **réels** capturés sur
anime-sama.to (fiche Inazuma Eleven, `episodes.js` de la saison 1 VF, `episodes.js`
de One Piece saison 1 VOSTFR pour le cas `eps2` avant `eps1`, bloc de liste des
films de Dragon Ball Super, résultats de `fetch.php`, cartes de catalogue, embeds
ansembed et sibnet).

## Limites connues

- **Cloudflare** est devant le site. Les requêtes simples passent aujourd'hui
  avec un User-Agent de navigateur (`profile: "static"`) ; en cas de challenge,
  escalader vers `--profile fast` ou `stealth`.
- **YouTube et Dailymotion** ne sont pas résolus : ce sont des lecteurs
  propriétaires, pas des embeds de fichier. `resoudreLecteur` le signale sans
  émettre de requête.
- **Les URLs résolues sont signées et éphémères** (jeton `t=` + `e=` chez
  ansembed / embed4me) et exigent l'en-tête `Referer` renvoyé dans `enTetes`.
- Les hébergeurs fortement obfusqués (voe, mail.ru et clones) ne sont pas
  couverts : ils demanderaient un rendu JS.
- **Le sondage des langues coûte une requête par langue et par saison**
  (`listerLangues` : 9 langues × N saisons). Restreindre la liste quand on sait
  déjà ce qu'on cherche.

## Résolution des lecteurs

La reconnaissance de l'hébergeur, le déballage des scripts compressés,
l'extraction de la piste et la lecture des playlists HLS ne vivent plus dans ce
paquet : ils sont dans le **cœur média de bxc** (`@aphrody/bxc/media`), partagé
avec `@aphrody/voiranime`. Les mêmes hébergeurs servent les deux sites — un
domaine qui change ou une page qui bouge se corrige à un seul endroit.

Ce paquet ne garde que la traduction du résultat dans son vocabulaire
(`hebergeur`, `enTetes`, `qualites`) et la connaissance propre à anime-sama :
`episodes.js`, `panneauAnime`, la numérotation des lecteurs, les langues.

`resoudreLecteur` rend donc, en plus de l'URL : les en-têtes `Referer`/`Origin`
à rejouer, l'aperçu, les variantes du master HLS en **URL absolues** (deux
qualités de même hauteur sont départagées par leur débit), et une erreur
explicite quand le lecteur est propriétaire (YouTube, Dailymotion) ou obfusqué.
