# @aphrody/wonderbot

**Wonderbot** — le bot Discord du catalogue **Inazuma Eleven TV**.

Il sert une seule racine de commandes, `/ietv`, adossée au cache SQLite de
[`@aphrody/ietv`](../ietv) qu'il rafraîchit lui-même. Aucun serveur HTTP
intermédiaire, aucun démon cron séparé : un processus, une base.

```bash
bxc wonderbot doctor     # vérifie la configuration et le catalogue, sans Discord
bxc wonderbot refresh    # amorce/rafraîchit le catalogue, sans Discord
bxc wonderbot register   # publie les slash commands puis sort
bxc wonderbot start      # passerelle + rafraîchissement périodique + annonces
```

## Commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `/ietv recherche texte:<mot> [langue] [limite]` | Cherche dans les titres, VF et VOSTFR confondues |
| `/ietv episode saison:<n> numero:<n> [langue]` | Toutes les versions d'un épisode — un champ par source et par langue |
| `/ietv saison numero:<n> [langue]` | Les épisodes d'une saison, dans l'ordre |
| `/ietv catalogue` | Volumes, sources, répartition VF/VOSTFR, fraîcheur |
| `/ietv rafraichir` | Rescrape les sept sources. Réservé aux rôles de `WONDERBOT_STAFF_ROLE_IDS`, réponse éphémère |

Les quatre premières répondent en millisecondes : elles lisent le cache, jamais
YouTube. C'est aussi ce qui évite qu'un serveur de deux mille membres déclenche
deux mille scrapings.

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
| `WONDERBOT_ANNOUNCE_ROLE_ID` | Rôle mentionné dans l'annonce |
| `WONDERBOT_STAFF_ROLE_IDS` | Rôles autorisés à `/ietv rafraichir` ; vide ⇒ personne |
| `WONDERBOT_REFRESH_INTERVAL_MS` | Période, défaut 6 h, plancher 60 s |
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
