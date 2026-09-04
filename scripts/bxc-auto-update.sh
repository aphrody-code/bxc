#!/usr/bin/env bash
# bxc-auto-update.sh — mise a jour automatique du checkout de prod.
#
# Sur ce VPS, `bxc` n'est PAS un binaire : /usr/local/bin/bxc et
# ~/.local/bin/bxc sont des wrappers qui exec `bun /home/ubuntu/bxc/src/cli/
# index.ts`. Mettre a jour la prod = mettre a jour le checkout, pas telecharger
# un asset de release. C'est pourquoi ce script ne passe PAS par
# `bxc self-update` : celui-ci remplacerait un binaire que rien n'execute
# (cf. l'avertissement de DEPLOY.md sur la divergence des copies).
#
# Deroule, dans cet ordre — chaque etape peut annuler la suivante :
#
#   1. Rien a faire si le worktree est sale : une modif non commitee est du
#      travail en cours, un `merge --ff-only` par-dessus est un vol de donnees.
#   2. Rien a faire si l'amont de la branche courante == HEAD : cas nominal.
#   3. Fast-forward strict. Jamais de merge, jamais de rebase : si l'historique
#      a diverge, c'est une decision humaine, pas celle d'un timer.
#   4. `bun install --frozen-lockfile` : le lockfile fait foi, un timer ne
#      resout pas de dependances.
#   5. Fumee AVANT de toucher aux services (`--version` depuis les sources).
#      Un checkout qui ne demarre pas est remis a la revision precedente et
#      les services ne sont pas redemarres — mieux vaut de l'ancien code qui
#      tourne que du neuf qui refuse de booter.
#   6. Redemarrage des seules units bxc* actuellement actives : ce qui a ete
#      arrete a la main le reste.
#
# Tout est logge sur stdout (journalctl -u bxc-auto-update). Idempotent.
set -uo pipefail

REPO_ROOT="${REPO_ROOT:-/home/ubuntu/bxc}"
REMOTE="${BXC_UPDATE_REMOTE:-origin}"
# La branche suivie est celle du checkout, pas "main" en dur : la prod tourne sur
# `master`, et pointer un timer horaire sur une branche divergee le fait echouer
# a chaque passage (fast-forward impossible) sans que rien ne soit jamais mis a
# jour. Repli sur main si HEAD est detache.
BRANCH="${BXC_UPDATE_BRANCH:-}"
# Les units redemarrees apres une mise a jour reussie, si elles sont actives.
SERVICES=(bxc bxc-crawler bxc-scheduler)

ts(){ date -u '+%Y-%m-%d %H:%M:%S UTC'; }
log(){ echo "[$(ts)] $*"; }

log "=== auto-update run ==="
cd "$REPO_ROOT" || { log "  ✗ checkout introuvable : $REPO_ROOT"; exit 1; }

if [ -z "$BRANCH" ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  [ "$BRANCH" = "HEAD" ] && BRANCH=main   # HEAD detache : pas de branche a suivre
fi
log "  branche suivie : $REMOTE/$BRANCH"

# ── 1. worktree propre ? ────────────────────────────────────────────────────
dirty="$(git status --porcelain --untracked-files=no 2>/dev/null)"
if [ -n "$dirty" ]; then
  log "  · mise a jour sautee : modifications non commitees dans le worktree"
  echo "$dirty" | sed 's/^/      /'
  log "=== fin ==="
  exit 0
fi

# ── 2. du neuf en amont ? ───────────────────────────────────────────────────
if ! git fetch --quiet "$REMOTE" "$BRANCH" 2>&1 | sed 's/^/      /'; then
  log "  ✗ git fetch $REMOTE $BRANCH a echoue — reseau ou credentials"
  log "=== fin ==="
  exit 1
fi

before="$(git rev-parse HEAD)"
target="$(git rev-parse FETCH_HEAD)"
if [ "$before" = "$target" ]; then
  log "  ✓ deja a jour ($(git rev-parse --short HEAD))"
  log "=== fin ==="
  exit 0
fi
# HEAD contient deja l'amont (checkout en avance : commits locaux pas encore
# pousses). Le merge --ff-only serait un no-op, mais on redemarrerait les
# services a chaque passage horaire pour rien.
if git merge-base --is-ancestor "$target" "$before"; then
  log "  ✓ deja a jour : $REMOTE/$BRANCH ($(git rev-parse --short "$target")) est deja contenu dans HEAD ($(git rev-parse --short "$before"))"
  log "=== fin ==="
  exit 0
fi

log "  ⇣ $(git rev-parse --short "$before") → $(git rev-parse --short "$target")"
git log --oneline "$before..$target" 2>/dev/null | sed 's/^/      /'

# ── 3. fast-forward strict ──────────────────────────────────────────────────
if ! git merge --ff-only "$target" 2>&1 | sed 's/^/      /'; then
  log "  ✗ fast-forward impossible : l'historique local a diverge de $REMOTE/$BRANCH"
  log "    → intervention humaine requise, aucun service touche"
  log "=== fin ==="
  exit 1
fi

# ── rollback commun aux etapes suivantes ────────────────────────────────────
rollback(){ # $1=raison
  log "  ⟲ retour a $(git rev-parse --short "$before") — raison: $1"
  git reset --hard --quiet "$before" 2>&1 | sed 's/^/      /'
  bun install --frozen-lockfile >/dev/null 2>&1 || \
    log "    ! bun install post-rollback en echec — verifier node_modules a la main"
  log "=== fin ==="
  exit 1
}

# ── 4. dependances ──────────────────────────────────────────────────────────
if ! bun install --frozen-lockfile 2>&1 | sed 's/^/      /'; then
  rollback "bun install --frozen-lockfile en echec"
fi

# ── 5. fumee, avant de toucher aux services ─────────────────────────────────
# BXC_FROM_SOURCE=1 : on valide le chemin que les wrappers empruntent
# reellement, pas un binaire de dist/ qui peut etre perime.
if ! version="$(BXC_FROM_SOURCE=1 timeout 120 bun "$REPO_ROOT/src/cli/index.ts" --version 2>&1)"; then
  log "      $version"
  rollback "la CLI ne repond plus a --version depuis les sources"
fi
log "  ✓ fumee : $version"

# ── 6. redemarrage des units actives ────────────────────────────────────────
for s in "${SERVICES[@]}"; do
  state="$(systemctl is-active "$s.service" 2>/dev/null || true)"
  if [ "$state" = "active" ]; then
    log "  ⟲ restart $s.service"
    sudo systemctl restart "$s.service" 2>&1 | sed 's/^/      /'
  else
    log "  · $s.service ${state:-inconnu} — laisse en l'etat"
  fi
done

log "  ✓ mis a jour vers $(git rev-parse --short HEAD)"
log "=== fin ==="
