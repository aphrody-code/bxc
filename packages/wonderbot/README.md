# @aphrody/wonderbot

**Wonderbot** — le bot Discord d'un catalogue d'épisodes.

Il sert une seule racine de commandes, `/episodes`, adossée au cache SQLite de
[`@aphrody/ietv`](../ietv) qu'il rafraîchit lui-même. Aucun serveur HTTP
intermédiaire, aucun démon cron séparé : un processus, une base.

> **Surfaces publiques.** Le nom de la commande, ses descriptions, le pied de
> page des embeds et les noms de salons sont vus par chaque membre : aucun n'y
> emploie de nom déposé. La racine s'appelait `/ietv`, elle a été renommée pour
> cette raison, et `MARQUE_PAR_DEFAUT.piedDePage` ne nomme plus de produit. Les
> identifiants internes (paquet, fichiers, variables) ne sont pas concernés.

```bash
bxc wonderbot doctor     # vérifie la configuration et le catalogue, sans Discord
bxc wonderbot refresh    # amorce/rafraîchit le catalogue, sans Discord
bxc wonderbot register   # publie les slash commands puis sort
bxc wonderbot start      # passerelle + rafraîchissement périodique + annonces
```

## Commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `/episodes recherche texte:<mot> [langue] [limite]` | Cherche dans les titres, VF et VOSTFR confondues |
| `/episodes episode saison:<n> numero:<n> [langue]` | Toutes les versions d'un épisode — un champ par source et par langue |
| `/episodes saison numero:<n> [langue]` | Les épisodes d'une saison, dans l'ordre |
| `/episodes catalogue` | Volumes, sources, répartition VF/VOSTFR, fraîcheur |
| `/episodes rafraichir` | Rescrape les sept sources. Réservé aux **administrateurs du serveur** et aux rôles de `WONDERBOT_STAFF_ROLE_IDS`, réponse éphémère |

Les quatre premières répondent en millisecondes : elles lisent le cache, jamais
YouTube. C'est aussi ce qui évite qu'un serveur de deux mille membres déclenche
deux mille scrapings.

## Le forum comme catalogue

Quand `WONDERBOT_FORUM_CHANNEL_ID` désigne un salon **forum**, le bot y tient
**un fil par saison** : le message d'ouverture liste les épisodes, un lien par
langue, et le fil reste ouvert aux discussions des membres.

- **Un fil par saison, pas par épisode** : douze cents fils seraient illisibles,
  et Discord archive les plus anciens.
- **Le bot modifie, il ne republie pas.** Le message d'ouverture porte
  l'identifiant du fil et se modifie ; republier à chaque rafraîchissement
  noierait les réponses des membres sous des listes identiques.
- **Le fil est retrouvé par identifiant**, mémorisé dans le cache : un
  renommage ne casse rien, et un fil supprimé à la main est recréé.
- **Rien n'est jamais supprimé** : une saison qui disparaît du catalogue est
  plus souvent un scraping raté qu'une saison retirée.
- Les étiquettes `VF` / `VOSTFR` sont posées d'après les langues réellement
  présentes ; une étiquette absente du forum est ignorée plutôt que fatale.

Une saison complète (51 épisodes × 2 langues) **ne tient pas** dans une seule
description d'embed. D'où un format volontairement compact — pas de titre
d'épisode, liens raccourcis en `youtu.be` — et un découpage en plusieurs embeds
sous le plafond de 6 000 caractères que Discord applique à l'ensemble d'un
message. Au-delà, le fil renvoie vers `/episodes saison`.

Côté salon : refuser `CREATE_PUBLIC_THREADS` à `@everyone` — la liste des fils
**est** la liste des saisons, laisser ouvrir un fil quelconque la transformerait
en salon de discussion.

## Annonces des nouveautés

Après chaque rafraîchissement, les épisodes absents du passage précédent sont
publiés dans `WONDERBOT_ANNOUNCE_CHANNEL_ID`.

**Le premier passage n'annonce rien.** Un bot fraîchement installé voit tout le
catalogue comme « nouveau » ; il amorce donc son journal en silence, et la
première annonce portera sur un épisode paru *après* l'installation.

Le journal mémorise des **identifiants**, pas une date : une source qui remet en
ligne un épisode ancien (rattrapage de saison) serait manquée par un curseur
temporel. Il est élagué à chaque passage sur ce que le catalogue contient
encore, il ne grossit donc pas indéfiniment.

## Rafraîchissement automatique et réparation

**Au démarrage**, le bot rafraîchit **si et seulement si** le catalogue est vide
ou plus vieux que l'intervalle. Le « si » est tout l'intérêt : rescraper à
chaque `systemctl restart` coûterait plusieurs minutes de navigateur pour rien,
et un service qui redémarre en boucle martèlerait les sources. Ensuite, la
boucle périodique prend le relais (6 h par défaut).

**Quand un épisode manque au milieu d'une saison**, le bot retente.

- Un **trou** est un numéro absent *entre* le premier et le dernier épisode
  connus. Une saison qui s'arrête à E12 n'a pas de trou — elle est en cours de
  diffusion. On ne cherche jamais au-delà du dernier épisode connu.
- Chaque trou a un nombre **fixe** de tentatives (2 par défaut), espacées de
  15 min. Sans cette borne, un catalogue durablement incomplet relancerait un
  scraping toutes les quinze minutes, pour toujours.
- Passé ce compte, le trou est **confirmé** : le bot cesse d'y revenir et
  l'affiche dans le fil de la saison, sous « ⚠️ Introuvables ». Un épisode qu'on
  sait manquant est une information ; la taire laisse croire la liste complète.
- Un trou qui disparaît **récupère ses tentatives** : une source qui republie
  son catalogue mérite qu'on retente.
- Une seule réparation en vol à la fois.

`WONDERBOT_AUTOFIX_ATTEMPTS=0` désactive la réparation,
`WONDERBOT_REFRESH_ON_START=0` le rafraîchissement de démarrage.

## Configuration

Le premier nom trouvé gagne — les variantes historiques évitent de dupliquer un
`.env` existant.

| Variable | Rôle |
| --- | --- |
| `WONDERBOT_DISCORD_TOKEN` · `DISCORD_BOT_TOKEN` · `DISCORD_TOKEN` | Jeton du bot |
| `WONDERBOT_APPLICATION_ID` · `DISCORD_APPLICATION_ID` · `DISCORD_CLIENT_ID` | Application ID |
| `WONDERBOT_GUILD_ID` · `DISCORD_GUILD_ID` | Guilde(s) ; **vide ⇒ commandes globales** |
| `WONDERBOT_COMMAND_SCOPE` | `guildes` (propagation immédiate) ou `globale` (quelques minutes, tout serveur qui invite) |
| `WONDERBOT_ANNOUNCE_CHANNEL_ID` | Salon des nouveautés ; absent ⇒ aucune annonce |
| `WONDERBOT_FORUM_CHANNEL_ID` | Salon forum tenant le catalogue (un fil par saison) ; absent ⇒ pas de forum |
| `WONDERBOT_ANNOUNCE_ROLE_ID` | Rôle mentionné dans l'annonce |
| `WONDERBOT_STAFF_ROLE_IDS` | Rôles autorisés à `/episodes rafraichir` **en plus** des administrateurs ; vide ⇒ administrateurs seuls |
| `WONDERBOT_REFRESH_INTERVAL_MS` | Période, défaut 6 h, plancher 60 s |
| `WONDERBOT_REFRESH_ON_START` | `0` pour ne pas rafraîchir au démarrage même si le catalogue est périmé |
| `WONDERBOT_AUTOFIX_ATTEMPTS` | Tentatives par épisode manquant, défaut 2 ; `0` désactive |
| `WONDERBOT_AUTOFIX_DELAY_MS` | Délai avant une tentative, défaut 15 min, plancher 60 s |
| `WONDERBOT_ANNOUNCE_LIMIT` | Épisodes annoncés d'un coup, défaut 5 |
| `IETV_CACHE_PATH` | Base SQLite ; défaut `~/.cache/ietv/episodes.db` |

Une configuration incomplète fait **refuser le démarrage** avec le nom de la
variable à poser — plutôt qu'un « An invalid token was provided » qui ne dit ni
quelle variable, ni où, ni pour quelle application. Deux valeurs présentes mais
inutilisables sont refusées explicitement : un secret scellé (`eyJ2Ijo…`) et une
référence shell non substituée (`$AUTRE`), Bun ne faisant pas l'expansion dans un
`.env`.

## Permissions Discord

L'URL d'invitation, avec `<APPLICATION_ID>` remplacé :

```
https://discord.com/oauth2/authorize
  ?client_id=<APPLICATION_ID>
  &scope=bot%20applications.commands
  &permissions=19456
```

`scope=applications.commands` n'est pas optionnel : sans lui, le bot apparaît en
ligne et reste **strictement muet**.

`permissions=19456` est la somme de trois bits, et de trois seulement :
`ViewChannel` (1024) pour résoudre le salon d'annonces, `SendMessages` (2048)
pour y publier, `EmbedLinks` (16384) parce que l'annonce est un embed. Ni
administrateur, ni gestion de messages, ni mention de `@everyone` : le bot ne
modère rien et ne modifie personne.

**Aucun intent privilégié.** Le client ne demande que `Guilds` : les rôles de
l'appelant arrivent dans la charge utile de l'interaction, il n'y a rien à lire
dans le cache des membres. `GuildMembers` demandé sans être coché dans le
portail ferme la passerelle (code 4014) et fait boucler le service ;
`MessageContent` serait un accès au contenu des messages dont le bot n'a aucun
usage.

## Architecture

```
src/
├── config.ts          env → configuration validée (PUR)
├── catalogue.ts       lecture + rafraîchissement du cache IETV (cache et scraper injectables)
├── annonces.ts        journal des épisodes déjà annoncés (PUR + persistance)
├── forum.ts           un fil par saison, tenu à jour (passerelle Discord injectable)
├── lacunes.ts         détection des épisodes manquants + réparation bornée (PUR + persistance)
├── planificateur.ts   boucle périodique (minuteurs injectables)
├── commands/ietv.ts   les cinq sous-commandes → embeds (ne connaît PAS discord.js)
├── ui/                charte : couleurs, icônes, budget des embeds, mise en forme
└── bot.ts             SEUL module qui parle à discord.js
```

Un seul module touche la passerelle. Tout le reste — configuration, catalogue,
annonces, planification, commandes, rendu — se teste avec des objets littéraux :
`src/wonderbot.test.ts` couvre 63 cas sans jeton, sans réseau, sans SQLite et
sans navigateur, minuteurs compris (horloge factice, aucune attente réelle).

## Déploiement

```bash
sudo cp scripts/deploy/bxc-wonderbot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bxc-wonderbot
journalctl -u bxc-wonderbot -f
```

L'unité durcit le service (`ProtectSystem=strict`, `ProtectHome=read-only`) et
ouvre en écriture le **seul** chemin nécessaire, `~/.cache/ietv` : SQLite en mode
WAL écrit des fichiers voisins (`-wal`, `-shm`), une base lue seulement ne
suffit pas. `MemoryDenyWriteExecute` est proscrit — il casse le JIT de Bun.

Deux codes de sortie sont traités à part : **130** (arrêt propre) est un succès,
sinon `systemctl stop` laisserait l'unité en `failed` ; **77** (configuration
refusée) empêche le redémarrage, parce que relancer ne répare pas un jeton
absent.

## Licence

Apache-2.0
