# Défauts de bxc — rapport mesuré du 5 septembre 2026

Relevé pendant une session d'extraction réelle (zukan.inazuma.jp, fandom.com,
azalee.rosegriffon.fr) avec **bxc 0.9.3** installé, dépôt en 0.9.4, sur le VPS Linux.

Chaque point porte sa reproduction et son chiffre. **Six sont corrigés** ; les autres sont
ouverts, avec ce qu'il faudrait faire. Tout a été retesté après correction sur les URL réelles
de la session — le détail des mesures est dans chaque section.

Le fil rouge : **bxc échoue en silence avec un code de sortie 0**. Ce n'est pas un défaut de
robustesse — c'est le mode d'échec le plus cher qui soit, parce que l'appelant traite le vide
comme une réponse et bâtit dessus.

---

## 1. La base de cache était résolue contre le répertoire courant — CORRIGÉ

`src/db/BxcDB.ts` : `path ?? Bun.env.BXC_DB_PATH ?? resolve(process.cwd(), "data/bxc.sqlite")`.

Sans `BXC_DB_PATH`, **chaque dossier depuis lequel on lance bxc obtient sa propre base**, donc
son propre cache. Constaté sur ce VPS : trois bases distinctes, créées par le simple fait
d'avoir lancé bxc depuis trois endroits.

```
/home/ubuntu/bxc/data/bxc.sqlite
/home/ubuntu/rg/data/bxc.sqlite
/home/ubuntu/niers/data/bxc.sqlite
```

Conséquence vécue : la même URL avec le même profil rend un résultat différent selon le `cwd`,
et `--force` passe pour le seul remède alors que le problème est ailleurs.

**Correctif** : repli sur `~/.bxc/bxc.sqlite`. `BXC_DB_PATH` reste prioritaire.

## 2. Le cache servait des échecs, indéfiniment — CORRIGÉ

`isCrawlFailure()` existe et est correcte : elle rejette un corps de moins de 50 caractères,
les interstitiels Cloudflare, les titres de blocage. Mais elle n'était appelée **qu'au moment
du crawl**, jamais à la lecture du cache — et une entrée vide, une fois écrite, était resservie
sans fin.

Mesure sur `~/bxc/data/bxc.sqlite` :

```sql
select count(*) total, sum(case when length(coalesce(markdown,''))<50 then 1 else 0 end) vides
  from scrapes;
-- 365 | 137
```

**137 entrées inexploitables sur 365, soit 37,5 %.** Vécu comme : `bxc scrape <url> --markdown`
rend 2 octets, code de sortie 0 ; on change de profil, toujours 2 octets ; seul `--force`
finit par rendre la page.

**Correctif** : `isCacheUnusable()`, appliquée aux deux chemins de lecture (Redis et SQLite).
Une entrée Redis inexploitable est purgée ; une entrée SQLite inexploitable est ignorée et la
page recrawlée.

**Reste à faire** : purger les 137 entrées existantes (`delete from scrapes where
length(coalesce(markdown,'')) < 50`), et ajouter la même garde **à l'écriture** dans les
chemins autres que `smartFetch` — quelque chose les a écrites, et ce n'est pas `smartFetch`,
qui lève correctement.

## 3. Une sortie vide passait pour un succès — CORRIGÉ

`src/cli/scrape.ts` écrivait `result.markdown` sur stdout sans le regarder. Un markdown vide
sortait donc avec le code 0.

```
bxc scrape https://azalee.rosegriffon.fr/chara/... --markdown --profile stealth
# → 98 octets (juste la ligne de log), exit 0
```

**Correctif** : sous 50 caractères utiles, message d'erreur nommant le profil, la source et la
taille du HTML, puis `EXIT.DATA_ERR`.

## 4. `[smartFetch]` écrivait sur stdout, dans le Markdown — CORRIGÉ

`src/crawler/crawl-utils.ts` : `console.log("[smartFetch] Trying profile: …")`. Comme
`bxc scrape --markdown` écrit son résultat sur **stdout**, cette ligne se retrouvait en tête du
Markdown de chaque page. Tout consommateur devait la filtrer.

**Correctif** : `console.error`. Le diagnostic va sur stderr, le résultat sur stdout.

## 5. `bxc chrome` était inutilisable — CORRIGÉ

```
$ bxc chrome launch
[chrome] launching native Chromium from /usr/local/bin/google-chrome...
error: no bin target named `bxc-engine` in default-run packages
```

Deux causes cumulées :

- `rust-bridge/crates/bxc-engine/Cargo.toml` déclare **deux `[[bin]]`** (`bxc-engine` et
  `obscura-worker`) **sans `default-run`** ;
- le binaire n'est pas construit (`rust-bridge/target/release/bxc-engine` absent), donc le CLI
  tombe sur le repli `cargo run`, qui échoue pour la raison ci-dessus.

L'utilisateur lit un message de cargo qui ne parle pas de ce qu'il a demandé, alors que Chrome
est parfaitement installé (`/usr/local/bin/google-chrome`, Chrome for Testing 147).

**Correctif** : `default-run = "bxc-engine"`, et le repli `cargo run` s'annonce désormais
(« compilation, 2-3 min à froid ») avec la commande de build à lancer pour l'éviter.

---

## Défauts ouverts

### 6bis. `bun run build:linux` ne construit pas `bxc-engine` — CORRIGÉ

C'est la **cause racine** du point 5, et elle est ailleurs que dans le code Rust.

`package.json` : `"build:linux": "cd rust-bridge && cargo build --release && …"`. Or ce
workspace a un **paquet racine** (`.` figure dans ses `members`). Dans ce cas, `cargo build`
sans `-p` ni `--workspace` ne construit **que le paquet racine**. Mesuré après un build complet
réussi :

```
rust-bridge/target/release/libbxc_rust_bridge.so   13 315 400 o   ✔ produit
rust-bridge/target/release/bxc-engine              absent         ✘ jamais construit
```

Aucune erreur, aucun avertissement : le build se termine « avec succès » sans son binaire
principal. C'est ce que `CLAUDE.md` décrit comme une fatalité à contourner à la main
(« binaire absent : reconstruire via `cargo build -p bxc-engine --release` ») — ce n'en était
pas une, c'était un drapeau manquant.

**Correctif** : `cargo build --release --workspace`. Vérifié : `bxc-engine` est alors produit
(58 866 144 o, 2 min 22 s).

### 6. Les profils navigateur rendent une page tronquée — TOUJOURS OUVERT

Une fois `bxc-engine` construit, les profils navigateur **démarrent** (plus d'erreur cargo).
Mais ils rendent beaucoup moins que `http`, sur la même URL, au même instant :

| Profil | Octets de Markdown sur `zukan.inazuma.jp/en/chara_list/?q=…` |
|---|---:|
| `http` | **14 776** |
| `fast` | 1 765 |
| `stealth` | 987 |

Soit **8 à 15 fois moins**, et pourtant **exit 0** des deux côtés : la page tronquée passe la
garde des 50 caractères. Un profil censé être plus capable qu'un simple `fetch` doit rendre au
moins autant, sinon il n'a aucune raison d'exister.

Piste : le DOM est probablement lu avant la fin du montage, ou le moteur n'exécute pas le
JavaScript du site. À rapprocher du point 7 — un contrôle CDP direct sur le même domaine rend
518 Ko de DOM monté, donc le problème est dans l'attente/extraction, pas dans le navigateur.

Deux correctifs à envisager ensemble : attendre un signal de fin de montage
(`Page.loadEventFired` + quiescence réseau) plutôt qu'un délai fixe, et **comparer les profils
entre eux** dans les tests — un profil qui rend 10× moins que `http` sur la même URL doit faire
échouer la CI.

Conséquence directe du point 5 : ces profils passent par `WebSocketTransport`, qui spawn
`bxc-engine`. Binaire absent ⇒ pas de navigateur ⇒ page vide. Après correction du `default-run`
il faut **vérifier de bout en bout**, et surtout : un profil navigateur qui ne peut pas démarrer
son moteur doit **le dire et échouer**, jamais rendre une page vide.

Contournement pendant la session : piloter Chrome soi-même en CDP. 518 Ko de DOM monté et
158 requêtes capturées là où bxc rendait une coquille.

### 7. Le stub CDP se fait passer pour un navigateur

Un serveur répond sur `127.0.0.1:9222/json/version` avec
`{"Browser":"Bxc/0.1.0 (static)","webSocketDebuggerUrl":"ws://…"}`. Tout client CDP standard
(puppeteer, playwright, code maison) le prend pour Chrome, s'y connecte, et **toutes les pages
ressortent vides**.

Il faut soit qu'il implémente réellement `Page.navigate`, soit qu'il **n'annonce pas**
`webSocketDebuggerUrl` tant qu'il ne peut pas servir une page.

### 8. `bxc search` et `bxc google search` rendent une liste vide sans le dire

```
$ bxc search "亜風炉 照美" --json
{"query":"…","organic":[],"peopleAlsoAsk":[],"relatedSearches":[],
 "servedFromCache":false,"profileUsed":"fetch","authenticated":true}
$ bxc google search "亜風炉 照美 アフロディ" --json
[]
```

`authenticated: true` avec zéro résultat est contradictoire : soit l'authentification n'est pas
ce qu'elle prétend, soit le parseur ne reconnaît plus le DOM de résultats. Dans les deux cas,
zéro résultat sur une requête qui en a manifestement doit être **signalé**, pas rendu comme une
réponse normale. Un code de sortie distinct pour « aucun résultat » aiderait.

À noter : `bxc google suggest` **fonctionne parfaitement** sur la même requête (11 suggestions).
La brique Google n'est donc pas globalement cassée — c'est le chemin `search`.

### 9. `bxc google translate` : 429 sans repli ni temporisation

```
$ bxc google translate "亜風炉 照美"
[error] API Error 429: <html>…Sorry…</html>
```

Le second appel suffit à déclencher la limite. Deux manques : aucune temporisation
exponentielle, et le corps HTML de Google est déversé brut dans le message d'erreur au lieu
d'être résumé en « quota dépassé, réessayer dans N s ».

### 10. fandom.com n'est pas franchi, et l'API n'est pas essayée

```
$ bxc scrape https://inazuma-eleven.fandom.com/wiki/Afuro_Terumi --markdown --profile http --force
[smartFetch] Trying profile: http …
[smartFetch] Trying profile: fast …
# → corps vide
```

Or **l'API MediaWiki du même domaine répond parfaitement** en `curl` avec un User-Agent
explicite (`/api.php?action=parse&page=…&prop=text|wikitext|images|sections`). MediaWiki étant
un moteur ultra-répandu, un repli automatique « si le domaine expose `/api.php`, l'interroger
plutôt que d'escalader les profils » couvrirait des milliers de sites d'un coup, plus vite et
plus proprement que n'importe quel profil furtif.

### 11. Les paquets `packages/*` ne sont pas tous exposés au CLI

`@aphrody/zukan` existe dans le dépôt, mais `bxc zukan` n'est pas une sous-commande : l'appel
retombe sur l'aide générale, **avec un code de sortie 1 et sans dire que la commande est
inconnue**. Un message « sous-commande inconnue : zukan » vaudrait mieux qu'un dump d'aide.

### 12. Le CLI global est sensible au `bunfig.toml` du répertoire courant

```
$ cd /home/ubuntu/niers && bxc --help
error: Cannot find package 'nie' from '/home/ubuntu/niers/packages/nie-plugin/src/register.ts'
```

Le dépôt `niers` précharge un plugin Bun via son `bunfig.toml`. Un binaire **installé
globalement** ne devrait pas charger la configuration Bun du dossier où il est lancé : bxc
devient inutilisable dans n'importe quel dépôt qui a un `bunfig.toml` avec `preload`.

---

## Ce qui marche très bien, et qu'il ne faut pas casser

- `bxc scrape --markdown --profile http --force` : rapide, propre, fidèle. C'est le chemin qui
  a fait tout le travail de la session (zukan EN/JA, fiches détaillées, pages Next.js).
- `isCrawlFailure()` : la fonction est juste et bien pensée — elle était simplement appelée à un
  seul endroit sur trois.
- `bxc google suggest` : keyless, rapide, exact.
- La conversion HTML → Markdown : les tableaux complexes du zukan (13 colonnes, images et liens
  imbriqués dans les cellules) ressortent parsables.

## Priorité suggérée pour la prochaine session

1. Purger les 137 entrées de cache inexploitables et trouver **qui** les écrit (ce n'est pas
   `smartFetch`).
2. Comprendre pourquoi les profils navigateur rendent 8 à 15× moins que `http` (point 6). Le
   binaire se construit désormais et démarre : ce qui reste est un problème d'attente ou
   d'extraction du DOM, pas de lancement. Ajouter un test qui compare les profils entre eux
   sur une même URL.
3. Repli MediaWiki automatique quand le domaine expose `/api.php` (point 10) — le meilleur
   rapport couverture/effort du lot.
4. Réparer ou retirer `search` ; il ment aujourd'hui par omission (point 8).
5. Isoler le CLI du `bunfig.toml` ambiant (point 12).
