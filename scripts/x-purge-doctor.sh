#!/usr/bin/env bash
#
# Copyright 2026 aphrody-code
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# x-purge-doctor.sh — surveille et répare les purges X autonomes.
#
# Couvre les deux daemons (`bxc x unfollow` et `bxc x purge-tweets`). Une purge
# qui n'est ni `enabled` ni lancée est ignorée : déposer un fichier d'unité ne
# vaut pas « lance cette purge », sinon installer le doctor déclencherait des
# suppressions que personne n'a demandées. Le doctor peut donc être déployé
# avant que la seconde purge ne soit activée.
#
# Tourne en root (systemd), pilote systemctl et rebascule sur l'utilisateur
# propriétaire de la session (runuser) pour tout ce qui touche au journal et
# aux cookies. Tout est idempotent : le relancer ne peut rien casser.
#
# Contrôles globaux (une fois) :
#   1. binaire bxc présent et à jour
#   2. session X acceptée, sinon resync depuis le jar de cookies
#
# Contrôles par purge :
#   3. journal lisible                              → replanifie si absent
#   4. file vide                                    → arrête et désactive
#   5. unité en `failed`                            → reset-failed + start
#   6. unité arrêtée alors que la file ne l'est pas → start
#   7. aucune progression depuis STALL_MIN          → restart
#   8. unité activée mais pas au boot               → enable
#
# Usage : x-purge-doctor.sh [--dry-run] [--only <unfollow|tweets>]
#
# Code de retour 0 si tout va bien ou a été réparé, 1 s'il reste une anomalie
# qui demande une intervention humaine (typiquement une session morte).

set -uo pipefail

readonly RUN_USER="${BXC_X_USER:-ubuntu}"
readonly RUN_HOME="${BXC_X_HOME:-/home/${RUN_USER}}"
readonly BXC_BIN="${BXC_BIN:-/usr/local/bin/bxc}"
readonly COOKIE_JAR="${RUN_HOME}/.bxc/cookies/xcom.json"

# Sans progression pendant ce délai alors que l'unité tourne, on la relance.
# Large exprès : le moteur dort légitimement jusqu'à ~15 min entre deux
# fenêtres, et bien plus une fois le plafond journalier atteint.
readonly STALL_MIN="${BXC_X_STALL_MIN:-1500}"

# nom | unité systemd | motif du journal | sous-commande de replanification
readonly PURGES=(
  "unfollow|bxc-x-unfollow.service|x-unfollow-*.json|unfollow"
  "tweets|bxc-x-purge-tweets.service|x-purge-tweets-*.json|purge-tweets"
)

DRY_RUN=0
ONLY=""
while (( $# )); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    *) printf 'usage: %s [--dry-run] [--only <unfollow|tweets>]\n' "${0##*/}" >&2; exit 2 ;;
  esac
  shift
done

FIXES=0
PROBLEMS=0

log()   { printf '[doctor] %s\n' "$*"; }
alert() { printf '[doctor][ALERT] %s\n' "$*" >&2; PROBLEMS=$((PROBLEMS + 1)); }

# Applique une réparation, ou l'annonce seulement en --dry-run.
fix() {
  local what="$1"; shift
  if (( DRY_RUN )); then
    log "FIX (dry-run) $what : $*"
    return 0
  fi
  log "FIX $what"
  "$@"
  local rc=$?
  if (( rc == 0 )); then
    FIXES=$((FIXES + 1))
  else
    alert "la réparation « $what » a échoué (rc=$rc)"
  fi
  return $rc
}

# Exécute bxc sous l'utilisateur de la session, jamais en root : le journal et
# les cookies doivent rester possédés par lui.
as_user() {
  runuser -u "$RUN_USER" -- env "HOME=${RUN_HOME}" "$@"
}

# --- 1. binaire ------------------------------------------------------------
if [[ ! -x "$BXC_BIN" ]]; then
  alert "binaire absent : $BXC_BIN — rebuild puis redéployer (voir DEPLOY.md)"
  echo "[doctor] statut: KO (binaire manquant)"
  exit 1
fi
# Capture avant de grepper : `bxc x <cmd> --help` sort en 1 (EXIT.MISUSE) et,
# sous `set -o pipefail`, ça masquerait un grep pourtant réussi.
BXC_HELP="$("$BXC_BIN" x purge-tweets --help 2>&1 || true)"
if ! grep -q -- '--max-likes' <<<"$BXC_HELP"; then
  alert "$BXC_BIN ne connaît pas 'x purge-tweets' — binaire périmé, rebuild nécessaire"
  echo "[doctor] statut: KO (binaire périmé)"
  exit 1
fi

# --- 2. santé de la session (une seule fois, partagée) ---------------------
# Inutile de relancer des daemons qui vont se faire rejeter : on teste d'abord.
SESSION_OK=1
if ! as_user timeout 90 "$BXC_BIN" x whoami >/dev/null 2>&1; then
  SESSION_OK=0
  alert "session X rejetée — tentative de resynchronisation depuis le jar"

  if [[ -r "$COOKIE_JAR" ]]; then
    if (( DRY_RUN )); then
      log "FIX (dry-run) resync session depuis $COOKIE_JAR"
    elif python3 - "$COOKIE_JAR" "${RUN_HOME}/.aphrody/x-session.json" <<'PY'
import json, os, sys

jar_path, session_path = sys.argv[1], sys.argv[2]
jar = json.load(open(jar_path))
cookies = {c["name"]: c["value"] for c in jar if isinstance(c, dict) and "name" in c}
auth, ct0 = cookies.get("auth_token"), cookies.get("ct0")
if not auth or not ct0:
    sys.exit("jar sans auth_token/ct0")

try:
    session = json.load(open(session_path))
except Exception:
    session = {}

if session.get("auth_token") == auth and session.get("ct0") == ct0:
    sys.exit("jar identique a la session courante")

session["auth_token"], session["ct0"] = auth, ct0

# Ecriture atomique en 0600 des la creation : le doctor tourne en root (umask
# 0022), un simple open(..., "w") laisserait auth_token/ct0 en 0644 pendant la
# duree de l'ecriture — et definitivement si json.dump levait (ENOSPC).
tmp = session_path + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
try:
    with os.fdopen(fd, "w") as fh:
        json.dump(session, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, session_path)
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
os.chmod(session_path, 0o600)
PY
    then
      chown "${RUN_USER}:${RUN_USER}" "${RUN_HOME}/.aphrody/x-session.json" 2>/dev/null || true
      FIXES=$((FIXES + 1))
      log "FIX session resynchronisée depuis le jar"
      as_user timeout 90 "$BXC_BIN" x whoami >/dev/null 2>&1 && SESSION_OK=1
    else
      log "jar inutilisable ou déjà identique — pas de resync possible"
    fi
  else
    log "jar absent ($COOKIE_JAR) — pas de resync possible"
  fi
fi

# --- contrôles par purge ---------------------------------------------------
TOTAL_REMAINING=0
CHECKED=0

check_purge() {
  local name="$1" unit="$2" pattern="$3" subcmd="$4"

  # Une unité seulement *installée* ne doit pas être pilotée : déposer le
  # fichier ne veut pas dire « lance cette purge ». Le signal d'intention est
  # `enable` (ou un daemon déjà lancé à la main). Sans ça, le doctor
  # construirait le journal puis démarrerait une purge irréversible que
  # personne n'a demandée.
  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    return 0
  fi
  local enabled active
  enabled="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
  active="$(systemctl is-active "$unit" 2>/dev/null || true)"
  if [[ "$enabled" != "enabled" && "$active" != "active" && "$active" != "activating" \
        && "$active" != "failed" ]]; then
    log "[$name] purge non activée (systemctl enable $unit pour la piloter) — ignorée"
    return 0
  fi
  CHECKED=$((CHECKED + 1))

  local state
  state="$(find "${RUN_HOME}/.aphrody" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | head -1)"

  if [[ -z "$state" ]] || ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$state" 2>/dev/null; then
    # Daemon vivant sans journal = il est encore en train de parcourir les
    # timelines (des dizaines de minutes quand X impose des pauses 429). Le
    # journal n'est écrit qu'une fois la file construite. Lancer un --refresh
    # ici ajouterait un second lecteur sur le même cookie : les deux se
    # partageraient le quota de lecture, le parcours ralentirait, le journal
    # resterait absent — et le doctor empilerait un lecteur de plus toutes les
    # 10 min. On laisse le daemon finir.
    if [[ "$active" == "active" || "$active" == "activating" ]]; then
      log "[$name] journal pas encore écrit — le daemon construit la file, on le laisse faire"
      return 0
    fi
    alert "[$name] journal absent ou illisible"
    # Même hors systemd, un lecteur peut déjà tourner (dry-run lancé à la
    # main). Deux parcours simultanés sur le même cookie = 429 garantis.
    if pgrep -u "$RUN_USER" -f "x $subcmd" >/dev/null 2>&1; then
      log "[$name] un parcours est déjà en cours hors systemd — pas de replanification"
      return 0
    fi
    # Un dry-run reconstruit le plan : il relit les timelines et réécrit le journal.
    fix "[$name] replanification du journal" \
      as_user timeout 1800 "$BXC_BIN" x "$subcmd" --refresh >/dev/null 2>&1
    state="$(find "${RUN_HOME}/.aphrody" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | head -1)"
    [[ -z "$state" ]] && { alert "[$name] replanification impossible"; return 1; }
  fi

  local remaining done_count updated_at
  read -r remaining done_count updated_at <<<"$(python3 - "$state" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
print(len(s.get("queue", [])), len(s.get("done", {})), int(s.get("updated_at", 0)))
PY
)"
  TOTAL_REMAINING=$((TOTAL_REMAINING + remaining))

  # --- file vide → terminé -------------------------------------------------
  if (( remaining == 0 )); then
    log "[$name] file vide — ${done_count} traités, purge terminée"
    if [[ "$active" == "active" || "$active" == "activating" ]]; then
      fix "[$name] arrêt du daemon (plus rien à faire)" systemctl stop "$unit"
    fi
    if [[ "$enabled" == "enabled" ]]; then
      fix "[$name] désactivation au boot" systemctl disable "$unit"
    fi
    return 0
  fi

  # --- session morte : couper plutôt que marteler --------------------------
  if (( ! SESSION_OK )); then
    if [[ "$active" == "active" || "$active" == "activating" ]]; then
      fix "[$name] arrêt du daemon (session morte)" systemctl stop "$unit"
    fi
    return 1
  fi

  # --- unité en échec ------------------------------------------------------
  if [[ "$active" == "failed" ]] || systemctl is-failed --quiet "$unit" 2>/dev/null; then
    alert "[$name] unité en échec"
    fix "[$name] reset-failed" systemctl reset-failed "$unit"
    fix "[$name] redémarrage" systemctl start "$unit"
    active="$(systemctl is-active "$unit" 2>/dev/null || true)"
  fi

  # --- unité arrêtée alors qu'il reste du travail --------------------------
  if [[ "$active" != "active" && "$active" != "activating" ]]; then
    alert "[$name] daemon arrêté avec ${remaining} cibles en file (état: ${active:-inconnu})"
    fix "[$name] démarrage du daemon" systemctl start "$unit"
  elif (( updated_at > 0 )); then
    # --- progression bloquée ----------------------------------------------
    local now_ms idle_min
    now_ms=$(( $(date +%s) * 1000 ))
    idle_min=$(( (now_ms - updated_at) / 60000 ))
    if (( idle_min > STALL_MIN )); then
      alert "[$name] aucune progression depuis ${idle_min} min (seuil ${STALL_MIN})"
      fix "[$name] redémarrage du daemon bloqué" systemctl restart "$unit"
    else
      log "[$name] ${done_count} traités / ${remaining} restants (dernière mutation il y a ${idle_min} min)"
    fi
  fi

  # --- réactivation au boot ------------------------------------------------
  if [[ "$enabled" != "enabled" ]]; then
    alert "[$name] unité non activée au boot"
    fix "[$name] enable" systemctl enable "$unit"
  fi
  return 0
}

for entry in "${PURGES[@]}"; do
  IFS='|' read -r name unit pattern subcmd <<<"$entry"
  [[ -n "$ONLY" && "$ONLY" != "$name" ]] && continue
  check_purge "$name" "$unit" "$pattern" "$subcmd"
done

if (( ! SESSION_OK )); then
  alert "session toujours rejetée : reconnecte-toi sur x.com, ré-exporte les cookies, puis 'bxc cookies save xcom <export.json>'"
  echo "[doctor] statut: KO (session morte)"
  exit 1
fi

if (( CHECKED == 0 )); then
  echo "[doctor] statut: OK (aucune purge installee)"
  exit 0
fi

if (( PROBLEMS > FIXES )); then
  echo "[doctor] statut: DEGRADE (${TOTAL_REMAINING} restants, ${FIXES} reparation(s), ${PROBLEMS} probleme(s))"
  exit 1
fi
echo "[doctor] statut: OK (${TOTAL_REMAINING} restants, ${FIXES} reparation(s))"
exit 0
