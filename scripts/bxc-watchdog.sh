#!/usr/bin/env bash
# bxc-watchdog.sh — auto-remédiation prod, calqué sur ~/shenron/scripts/watchdog.sh.
# Tourne toutes les 5 min via bxc-watchdog.timer. Quatre volets :
#
#   1. Endpoint CDP (bxc.service, :9222/json/version) : 3 échecs consécutifs
#      (~15 min) → restart bxc, rate-limité (cooldown 30 min) pour ne jamais
#      partir en boucle si le problème est structurel.
#   2. Mémoire par service (bxc/bxc-crawler/bxc-scheduler, sous cgroup
#      MemoryMax) : au dessus de 90% → restart préventif (arrêt net vs
#      SIGKILL cgroup en plein milieu d'une écriture SQLite).
#   3. Units systemd bxc* en échec → reset-failed + start, rate-limité
#      (cooldown 60 min) pour ne pas noyer le journal si la cause est
#      structurelle (donnée invalide, dépendance morte…). Une unit sortie sur
#      un code listé dans son RestartPreventExitStatus (77 = credentials
#      rejetés) est signalée mais jamais relancée : elle s'est arrêtée exprès.
#   4. Services bxc* attendus actifs mais arrêtés/désactivés → signalé
#      (pas de restart aveugle ici : un arrêt volontaire — ex. maintenance
#      manuelle — ne doit pas être annulé par le watchdog).
#
# Toutes les actions sont loggées sur stdout (capté par journalctl -u
# bxc-watchdog). Idempotent, safe en cron/timer.
set -uo pipefail

STATE_DIR="${STATE_DIR:-/tmp/bxc-watchdog}"
mkdir -p "$STATE_DIR"
ts(){ date -u '+%Y-%m-%d %H:%M:%S UTC'; }
log(){ echo "[$(ts)] $*"; }

# ── état (compteurs d'échecs consécutifs + cooldowns) ───────────────────────
get_fail(){ cat "$STATE_DIR/fail-$1" 2>/dev/null || echo 0; }
set_fail(){ echo "$2" > "$STATE_DIR/fail-$1"; }
cooldown_ok(){ # $1=clé $2=minutes — true si aucune action recente (ou jamais)
  local marker="$STATE_DIR/cooldown-$1"
  [ -f "$marker" ] || return 0
  local age_min
  age_min=$(( ($(date +%s) - $(stat -c %Y "$marker" 2>/dev/null || echo 0)) / 60 ))
  [ "$age_min" -ge "$2" ]
}
mark_cooldown(){ touch "$STATE_DIR/cooldown-$1"; }

restart_service(){ # $1=nom systemd $2=cooldown-min $3=raison
  if ! cooldown_ok "restart-$1" "$2"; then
    log "  · restart $1 sauté (cooldown $2 min actif) — raison: $3"
    return
  fi
  log "  ⟲ restart $1 — raison: $3"
  sudo systemctl restart "$1"
  mark_cooldown "restart-$1"
}

say_section(){ log "-- $1 --"; }
log "=== watchdog run ==="

# ── 1. endpoint CDP + remédiation service ───────────────────────────────────
say_section "endpoint CDP"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:9222/json/version 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then
  if [ "$(get_fail cdp)" != "0" ]; then log "  ✓ cdp rétabli ($code)"; fi
  set_fail cdp 0
else
  fail=$(( $(get_fail cdp) + 1 ))
  set_fail cdp "$fail"
  log "  ✗ cdp : HTTP $code (attendu 200) — échec consécutif #$fail"
  if [ "$fail" -ge 3 ]; then
    restart_service bxc 30 "cdp en échec depuis $fail cycles (~$((fail*5)) min)"
  fi
fi

# ── 2. mémoire par service (cgroup vs MemoryMax) ────────────────────────────
say_section "mémoire services"
check_service_memory(){ # $1=service
  local cur max
  cur=$(systemctl show "$1" -p MemoryCurrent --value 2>/dev/null)
  max=$(systemctl show "$1" -p MemoryMax --value 2>/dev/null)
  if [ -z "$cur" ] || [ -z "$max" ] || [ "$cur" = "[not set]" ] || [ "$max" = "infinity" ] || [ "$max" = "0" ]; then
    log "  · $1 : MemoryCurrent/MemoryMax indisponible, check sauté"
    return
  fi
  local pct=$(( cur * 100 / max ))
  log "  $1 : ${pct}% (cur=$((cur/1024/1024))M / max=$((max/1024/1024))M)"
  if [ "$pct" -ge 90 ]; then
    restart_service "$1" 30 "mémoire à ${pct}% de MemoryMax (préventif, évite le SIGKILL cgroup)"
  fi
}
check_service_memory bxc
check_service_memory bxc-crawler
check_service_memory bxc-scheduler

# ── 3. units systemd bxc* en échec ──────────────────────────────────────────
say_section "units en échec"
failed_units=$(systemctl list-units 'bxc*' --state=failed --no-legend --plain 2>/dev/null | awk '{print $1}')
if [ -z "$failed_units" ]; then
  log "  ✓ aucune unit bxc* en échec"
else
  for u in $failed_units; do
    log "  ✗ ALERTE : $u en échec — diagnostic: journalctl -u $u -n 50"
    # Une unit qui déclare RestartPreventExitStatus reste volontairement en
    # échec sur ces codes — 77 = credentials rejetés pour les daemons de purge
    # X et wonderbot. Les relancer rejouerait indéfiniment un démarrage voué à
    # échouer, et masquerait le signal « il faut renouveler la session ».
    main_status=$(systemctl show "$u" -p ExecMainStatus --value 2>/dev/null || true)
    prevent=$(systemctl show "$u" -p RestartPreventExitStatus --value 2>/dev/null || true)
    if [ -n "$main_status" ] && [ -n "$prevent" ] \
       && printf '%s\n' $prevent | grep -qx -- "$main_status"; then
      log "    · relance refusée : sortie $main_status listée dans RestartPreventExitStatus"
      continue
    fi
    if cooldown_ok "failed-$u" 60; then
      log "    ⟲ tentative de relance"
      sudo systemctl reset-failed "$u" 2>&1 | sed 's/^/      /'
      sudo systemctl start "$u" 2>&1 | sed 's/^/      /'
      mark_cooldown "failed-$u"
    else
      log "    · relance sautée (cooldown 60 min) — échec persistant, intervention requise"
    fi
  done
fi

# ── 4. services attendus actifs (signalement seul, pas de restart aveugle) ──
say_section "services attendus actifs"
for s in bxc bxc-crawler bxc-scheduler; do
  state=$(systemctl is-active "$s.service" 2>/dev/null || true)
  if [ "$state" = "active" ]; then
    log "  ✓ $s.service actif"
  else
    log "  ✗ ALERTE : $s.service ${state:-inconnu} (attendu: active) — pas de relance auto (peut être un arrêt volontaire)"
  fi
done

log "=== fin ==="
