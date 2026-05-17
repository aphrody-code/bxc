#!/usr/bin/env bash
#
# rename-radical-bxc.sh — final phase of the bunlight → bxc cutover.
#
# Runs OUTSIDE the repo directory (because it renames the repo dir itself),
# typically launched from a tmux session so SSH crash is survivable.
#
# Steps:
#   1. Sanity: not inside bunlight, branch ok, backup exists, .so built.
#   2. Push branch rebrand/bxc, fast-forward main, push main.
#   3. Rename GitHub repo aphrody-code/bunlight → aphrody-code/bxc.
#   4. Update local git remote URL to match the new repo name.
#   5. Rename filesystem paths:
#        ~/bunlight                            → ~/bxc
#        ~/.bunlight                           → ~/.bxc
#        ~/.local/bin/bunlight                 → ~/.local/bin/bxc
#        ~/.gemini/extensions/bunlight-gemini  → ~/.gemini/extensions/bxc-gemini
#   6. Patch /etc/systemd/system/gemma.service paths (sudo) and reload.
#   7. Patch sibling repos (vps, gemium) — clone, sed, commit, push.
#   8. Final report.
#
# Re-runnable: each step checks idempotency (skip if already done).
#
# Best practices:
#   - shellcheck clean
#   - set -euo pipefail + IFS
#   - explicit exit codes
#   - every action logged with [STEP] prefix
#   - all destructive actions print before running

set -euo pipefail
IFS=$'\n\t'

readonly LOG_PREFIX="[rename-bxc]"

readonly OLD_NAME="bunlight"
readonly NEW_NAME="bxc"

readonly OLD_REPO_DIR="${HOME}/${OLD_NAME}"
readonly NEW_REPO_DIR="${HOME}/${NEW_NAME}"

readonly OLD_CACHE_DIR="${HOME}/.${OLD_NAME}"
readonly NEW_CACHE_DIR="${HOME}/.${NEW_NAME}"

readonly OLD_BIN="${HOME}/.local/bin/${OLD_NAME}"
readonly NEW_BIN="${HOME}/.local/bin/${NEW_NAME}"

readonly OLD_GEMINI_EXT="${HOME}/.gemini/extensions/${OLD_NAME}-gemini"
readonly NEW_GEMINI_EXT="${HOME}/.gemini/extensions/${NEW_NAME}-gemini"

readonly GITHUB_OWNER="aphrody-code"

log()  { printf '%s %s\n' "${LOG_PREFIX}" "$*"; }
step() { printf '\n%s [STEP] %s\n' "${LOG_PREFIX}" "$*"; }
warn() { printf '%s [WARN] %s\n' "${LOG_PREFIX}" "$*" >&2; }
die()  { printf '%s [FATAL] %s\n' "${LOG_PREFIX}" "$*" >&2; exit 1; }

require() {
  for cmd in "$@"; do
    command -v "${cmd}" >/dev/null 2>&1 \
      || die "missing required dependency: ${cmd}"
  done
}

# ---------------------------------------------------------------------------
# Step 1 — Sanity checks
# ---------------------------------------------------------------------------
sanity_checks() {
  step "1. Sanity checks"
  require git gh systemctl sudo

  # We MUST not be inside the repo we're about to rename.
  if [[ "${PWD}" == "${OLD_REPO_DIR}" || "${PWD}" == ${OLD_REPO_DIR}/* ]]; then
    die "this script must be run from OUTSIDE ${OLD_REPO_DIR} (current cwd: ${PWD})"
  fi

  [[ -d "${OLD_REPO_DIR}/.git" ]] || die "${OLD_REPO_DIR} is not a git repo"
  local current_branch
  current_branch="$(git -C "${OLD_REPO_DIR}" rev-parse --abbrev-ref HEAD)"
  log "  current branch: ${current_branch}"
  if [[ "${current_branch}" != "rebrand/bxc" ]]; then
    die "expected branch 'rebrand/bxc', got '${current_branch}' — checkout it first"
  fi

  # Backup must exist before we touch anything.
  local backup_count
  backup_count=$(find "${HOME}" -maxdepth 1 -type d -name 'bunlight-backup-*' 2>/dev/null | wc -l)
  if [[ "${backup_count}" -eq 0 ]]; then
    die "no ${HOME}/bunlight-backup-* found — run scripts/backup-bunlight.sh first"
  fi
  log "  backup(s) found: ${backup_count}"

  # Rust .so must exist (proves Rust crate was rebuilt under new name).
  if [[ ! -f "${OLD_REPO_DIR}/rust-bridge/target/release/libbxc_rust_bridge.so" ]]; then
    die "libbxc_rust_bridge.so missing — run: cd ${OLD_REPO_DIR}/rust-bridge && cargo build --release"
  fi

  # No uncommitted changes.
  if ! git -C "${OLD_REPO_DIR}" diff-index --quiet HEAD --; then
    die "uncommitted changes in ${OLD_REPO_DIR} — commit or stash first"
  fi

  log "  sanity ok"
}

# ---------------------------------------------------------------------------
# Step 2 — Push branch + merge main + push main
# ---------------------------------------------------------------------------
push_and_merge() {
  step "2. Push rebrand/bxc, fast-forward main, push main"
  git -C "${OLD_REPO_DIR}" push -u origin rebrand/bxc 2>&1 | tail -5
  git -C "${OLD_REPO_DIR}" switch main
  git -C "${OLD_REPO_DIR}" merge --ff-only rebrand/bxc \
    || die "fast-forward merge failed (main diverged)"
  git -C "${OLD_REPO_DIR}" push origin main 2>&1 | tail -3
  log "  main pushed"
}

# ---------------------------------------------------------------------------
# Step 3 — Rename GitHub repo
# ---------------------------------------------------------------------------
rename_github_repo() {
  step "3. Rename GitHub repo ${GITHUB_OWNER}/${OLD_NAME} → ${GITHUB_OWNER}/${NEW_NAME}"
  # Idempotent: if the rename already happened, the new repo exists.
  if gh repo view "${GITHUB_OWNER}/${NEW_NAME}" >/dev/null 2>&1; then
    log "  ${GITHUB_OWNER}/${NEW_NAME} already exists — skip rename"
  else
    gh api -X PATCH "repos/${GITHUB_OWNER}/${OLD_NAME}" \
      -f "name=${NEW_NAME}" 2>&1 | tail -5
    log "  GitHub rename done"
  fi
}

# ---------------------------------------------------------------------------
# Step 4 — Update local git remote
# ---------------------------------------------------------------------------
update_git_remote() {
  step "4. Update local git remote URL"
  local new_url="https://github.com/${GITHUB_OWNER}/${NEW_NAME}.git"
  git -C "${OLD_REPO_DIR}" remote set-url origin "${new_url}"
  log "  origin → ${new_url}"
}

# ---------------------------------------------------------------------------
# Step 5 — Rename filesystem paths
# ---------------------------------------------------------------------------
rename_disk_paths() {
  step "5. Rename filesystem paths"

  # Repo dir
  if [[ -d "${OLD_REPO_DIR}" && ! -e "${NEW_REPO_DIR}" ]]; then
    mv -v "${OLD_REPO_DIR}" "${NEW_REPO_DIR}"
  elif [[ -d "${NEW_REPO_DIR}" ]]; then
    log "  ${NEW_REPO_DIR} already exists — skip"
  else
    warn "  ${OLD_REPO_DIR} missing — already renamed?"
  fi

  # Cache dir
  if [[ -d "${OLD_CACHE_DIR}" && ! -e "${NEW_CACHE_DIR}" ]]; then
    mv -v "${OLD_CACHE_DIR}" "${NEW_CACHE_DIR}"
  elif [[ -d "${NEW_CACHE_DIR}" ]]; then
    log "  ${NEW_CACHE_DIR} already exists — skip"
  fi

  # User binary
  if [[ -e "${OLD_BIN}" && ! -e "${NEW_BIN}" ]]; then
    mv -v "${OLD_BIN}" "${NEW_BIN}"
  elif [[ -e "${NEW_BIN}" ]]; then
    log "  ${NEW_BIN} already exists — skip"
  fi

  # Gemini extension
  if [[ -d "${OLD_GEMINI_EXT}" && ! -e "${NEW_GEMINI_EXT}" ]]; then
    mv -v "${OLD_GEMINI_EXT}" "${NEW_GEMINI_EXT}"
    # Also rename the inner compiled binary if any
    if [[ -f "${NEW_GEMINI_EXT}/bunlight-mcp" ]]; then
      mv -v "${NEW_GEMINI_EXT}/bunlight-mcp" "${NEW_GEMINI_EXT}/bxc-mcp"
    fi
  elif [[ -d "${NEW_GEMINI_EXT}" ]]; then
    log "  ${NEW_GEMINI_EXT} already exists — skip"
  fi
}

# ---------------------------------------------------------------------------
# Step 6 — Patch gemma.service paths + reload
# ---------------------------------------------------------------------------
patch_gemma_service() {
  step "6. Patch gemma.service paths (sudo) and reload"
  local svc="/etc/systemd/system/gemma.service"
  if [[ ! -f "${svc}" ]]; then
    log "  ${svc} missing — skipping"
    return 0
  fi
  if ! grep -q "/${OLD_NAME}/" "${svc}"; then
    log "  ${svc} already patched (no /${OLD_NAME}/ paths) — skip"
    return 0
  fi
  log "  patching ${svc}…"
  sudo sed -i.bak "s|/${OLD_NAME}/|/${NEW_NAME}/|g" "${svc}"
  log "  backup: ${svc}.bak"
  sudo systemctl daemon-reload
  log "  systemctl daemon-reload done"
  log "  (gemma.service is left STOPPED; start manually with: sudo systemctl start gemma)"
}

# ---------------------------------------------------------------------------
# Step 7 — Patch sibling repos (vps, gemium) that reference bunlight
# ---------------------------------------------------------------------------
patch_sibling_repos() {
  step "7. Patch sibling repos (vps, gemium)"
  local work_dir
  work_dir="${HOME}/bxc-sibling-patches-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "${work_dir}"

  for repo in vps gemium; do
    log "  --- ${repo} ---"
    local clone="${work_dir}/${repo}"
    if gh repo clone "${GITHUB_OWNER}/${repo}" "${clone}" -- --depth 1 2>&1 | tail -2; then
      local hits
      hits=$(rg -c "bunlight" --glob '!node_modules/**' "${clone}" 2>/dev/null \
        | awk -F: '{s+=$2} END {print s+0}')
      log "    initial hits: ${hits}"
      if [[ "${hits}" -gt 0 ]]; then
        # Apply all 4 axes in one go (sibling repos are smaller — bash sed is fine).
        find "${clone}" -type f \
          ! -path '*/node_modules/*' \
          ! -path '*/.git/*' \
          ! -name 'bun.lock' \
          ! -name 'package-lock.json' \
          -exec sed -i \
            -e 's|BUNLIGHT_|BXC_|g' \
            -e 's|Bunlight|Bxc|g' \
            -e 's|bunlight_|bxc_|g' \
            -e 's|bunlight|bxc|g' \
            {} +
        cd "${clone}"
        git add -A
        if ! git diff --cached --quiet; then
          git commit -m "chore(rebrand): bunlight → bxc references" 2>&1 | tail -3
          git push origin HEAD 2>&1 | tail -3
          log "    pushed"
        else
          log "    no diff after sed — skip commit"
        fi
        cd - >/dev/null
      fi
    else
      warn "    clone failed for ${repo}"
    fi
  done

  log "  sibling patches stored in: ${work_dir}"
}

# ---------------------------------------------------------------------------
# Step 8 — Final report
# ---------------------------------------------------------------------------
final_report() {
  step "8. Final report"
  cat <<EOF

    ╔════════════════════════════════════════════════════════════════╗
    ║                    BXC RENAME — DONE                           ║
    ╠════════════════════════════════════════════════════════════════╣
    ║  Repo:        ${NEW_REPO_DIR}
    ║  GitHub:      https://github.com/${GITHUB_OWNER}/${NEW_NAME}
    ║  Binary:      ${NEW_BIN}
    ║  Cache:       ${NEW_CACHE_DIR}
    ║  Gemini ext:  ${NEW_GEMINI_EXT}
    ║
    ║  Next manual steps (optional):
    ║   - sudo systemctl start gemma  (Gemma was stopped & disabled)
    ║   - cd ${NEW_REPO_DIR} && bun install  (refresh node_modules)
    ║   - cd ${NEW_REPO_DIR} && bun test  (validate everything)
    ║
    ║  Old repo URL: https://github.com/${GITHUB_OWNER}/${OLD_NAME}
    ║                (GitHub keeps a redirect for ~1 year)
    ╚════════════════════════════════════════════════════════════════╝

EOF
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log "rename-radical-bxc starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "log file: ${BXC_RENAME_LOG:-~/bxc-rename.log}"

  sanity_checks
  push_and_merge
  rename_github_repo
  update_git_remote
  rename_disk_paths
  patch_gemma_service
  patch_sibling_repos
  final_report

  log "done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

main "$@"
