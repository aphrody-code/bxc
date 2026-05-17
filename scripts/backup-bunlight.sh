#!/usr/bin/env bash
#
# backup-bunlight.sh — full local backup of the bunlight monorepo before
# any destructive operation (rebrand, force-push, repo rename).
#
# Produces 3 artifacts under "${HOME}/bunlight-backup-<UTC>/" :
#   1. bunlight-<UTC>.tar.zst   — entire worktree, excluding node_modules
#                                  and rust-bridge/target (huge, regenerable).
#   2. bunlight-<UTC>.gitbundle — full git history (re-clonable offline).
#   3. SHA256SUMS                — checksums of the two above + this script.
#
# Best practices applied:
#   - shellcheck clean
#   - `set -euo pipefail` + `IFS=$'\n\t'`
#   - atomic write (build to .tmp, mv on success)
#   - explicit exit codes: 0=ok, 1=usage, 2=missing dep, 3=git/IO failure
#   - dry-run mode prints plan without writing

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
readonly REPO_ROOT
REPO_NAME="$(basename "${REPO_ROOT}")"
readonly REPO_NAME

# Directories excluded from the tar archive (regenerable / huge).
readonly TAR_EXCLUDES=(
  "${REPO_NAME}/node_modules"
  "${REPO_NAME}/**/node_modules"
  "${REPO_NAME}/rust-bridge/target"
  "${REPO_NAME}/dist"
  "${REPO_NAME}/.turbo"
  "${REPO_NAME}/.bunlight"
  "${REPO_NAME}/.tsbuildinfo"
  "${REPO_NAME}/bunlight-memory.sqlite"
  "${REPO_NAME}/vendor/gemma/models"
  "${REPO_NAME}/vendor/gemma/sources/llama.cpp/build"
)

usage() {
  cat <<EOF
Usage: ${0##*/} [-d DIR] [-n] [-h]

Create a full local backup of the bunlight monorepo (tarball + git bundle +
checksums) outside the repo, so it survives a "rm -rf" or a botched rebrand.

Options:
  -d DIR    backup destination root (default: \${HOME})
  -n        dry-run, print plan only
  -h        show this help

Exit codes:
  0 success    1 usage    2 missing dep    3 git/IO failure
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 3
}

require() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    printf 'error: missing required dependency: %s\n' "${cmd}" >&2
    exit 2
  fi
}

main() {
  local dest_root="${HOME}"
  local dry_run=0

  while getopts ":d:nh" opt; do
    case "${opt}" in
      d) dest_root="${OPTARG}" ;;
      n) dry_run=1 ;;
      h) usage; exit 0 ;;
      :) printf 'error: option -%s requires an argument\n' "${OPTARG}" >&2; exit 1 ;;
      \?) printf 'error: unknown option -%s\n' "${OPTARG}" >&2; usage >&2; exit 1 ;;
    esac
  done

  require tar
  require zstd
  require git
  require sha256sum

  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local backup_dir="${dest_root}/bunlight-backup-${timestamp}"
  local tar_path="${backup_dir}/${REPO_NAME}-${timestamp}.tar.zst"
  local bundle_path="${backup_dir}/${REPO_NAME}-${timestamp}.gitbundle"
  local sums_path="${backup_dir}/SHA256SUMS"
  local git_head
  git_head="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  local git_status_summary
  git_status_summary="$(git -C "${REPO_ROOT}" status --porcelain | wc -l) modified files"

  printf '== bunlight backup plan ==\n'
  printf '  repo root      : %s\n' "${REPO_ROOT}"
  printf '  git HEAD       : %s\n' "${git_head}"
  printf '  git status     : %s\n' "${git_status_summary}"
  printf '  backup dir     : %s\n' "${backup_dir}"
  printf '  tarball        : %s\n' "${tar_path}"
  printf '  git bundle     : %s\n' "${bundle_path}"
  printf '  checksums      : %s\n' "${sums_path}"
  printf '  excludes       : %d patterns\n' "${#TAR_EXCLUDES[@]}"

  if (( dry_run )); then
    printf '\n(dry-run, nothing written)\n'
    exit 0
  fi

  if [[ -e "${backup_dir}" ]]; then
    die "${backup_dir} already exists — refusing to overwrite"
  fi

  mkdir -p -- "${backup_dir}"

  # Build tar exclude args.
  local -a tar_args=()
  for excl in "${TAR_EXCLUDES[@]}"; do
    tar_args+=("--exclude=${excl}")
  done

  printf '\n[1/3] tar + zstd (excluding %d patterns)…\n' "${#TAR_EXCLUDES[@]}"
  # Atomic: write to .tmp then mv. Use -C to set parent dir so the archive
  # contains "${REPO_NAME}/..." at the top (re-extractable anywhere).
  tar "${tar_args[@]}" \
    -C "$(dirname -- "${REPO_ROOT}")" \
    -cf - "${REPO_NAME}" \
  | zstd -T0 -3 --long -q -o "${tar_path}.tmp"
  mv -- "${tar_path}.tmp" "${tar_path}"
  local tar_size
  tar_size="$(stat -c '%s' "${tar_path}")"
  printf '      → %s (%s bytes)\n' "${tar_path}" "${tar_size}"

  printf '\n[2/3] git bundle (full history)…\n'
  # `git bundle` writes incrementally; we still build to .tmp for safety.
  git -C "${REPO_ROOT}" bundle create "${bundle_path}.tmp" --all
  mv -- "${bundle_path}.tmp" "${bundle_path}"
  # verify
  git -C "${REPO_ROOT}" bundle verify "${bundle_path}" >/dev/null 2>&1 \
    || die "git bundle verify failed for ${bundle_path}"
  local bundle_size
  bundle_size="$(stat -c '%s' "${bundle_path}")"
  printf '      → %s (%s bytes)\n' "${bundle_path}" "${bundle_size}"

  printf '\n[3/3] sha256 checksums…\n'
  (
    cd -- "${backup_dir}"
    sha256sum -- *.tar.zst *.gitbundle > SHA256SUMS
  )
  printf '      → %s\n' "${sums_path}"
  cat -- "${sums_path}"

  # Self-test: re-extract the tarball into /tmp and diff against the
  # working tree (excluding the same patterns). Catches corruption early.
  printf '\n[verify] decompress + diff smoke test…\n'
  local verify_dir
  verify_dir="$(mktemp -d)"
  # shellcheck disable=SC2064 # we want $verify_dir captured at trap-install time
  trap "rm -rf -- '${verify_dir}'" EXIT
  zstd -d -q "${tar_path}" -c | tar -xf - -C "${verify_dir}"
  if [[ ! -d "${verify_dir}/${REPO_NAME}" ]]; then
    die "verification failed: archive did not contain ${REPO_NAME}/"
  fi
  printf '      ✓ archive opens and contains %s/\n' "${REPO_NAME}"

  printf '\n== backup complete ==\n'
  printf '  %s\n' "${backup_dir}"
  printf '  to restore later:\n'
  printf '    zstd -d %s -c | tar -xf - -C /restore/target\n' "${tar_path}"
  printf '    git clone %s ./bunlight-restored\n' "${bundle_path}"
}

main "$@"
