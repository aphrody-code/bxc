#!/usr/bin/env bash
#
# scan-bunlight-refs.sh — first-pass scanner for "bunlight" references across
# the monorepo. Produces a JSON report consumed by scan-bunlight-refs.ts
# (Bun-native second pass) before the bxc rebrand.
#
# Best practices applied:
#   - shellcheck clean (`shellcheck -x scripts/scan-bunlight-refs.sh`)
#   - `set -euo pipefail` + `IFS=$'\n\t'` (https://mywiki.wooledge.org/BashFAQ/105)
#   - readonly globals, local in functions, quoted variables, printf > echo
#   - mapfile for arrays, [[ ]] for tests, $(...) over backticks
#   - JSON built with `jq` (no string concat — escapes are correct by construction)
#   - exit codes: 0=ok, 1=usage, 2=missing dep, 3=scan failure

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
readonly REPO_ROOT
readonly OUTPUT_FILE_DEFAULT="${REPO_ROOT}/reports/scan-v1-bash.json"

# Patterns to detect. Order matters for the JSON report only (first ⇒ top
# of the by_pattern object).
readonly PATTERNS=(
  "bunlight"
  "Bunlight"
  "BUNLIGHT_"
  "bunlight_"
  "@aphrody-code/bunlight"
  "libbunlight"
  ".bunlight/"
)

# Directories never scanned (vendored / generated / heavy).
readonly EXCLUDE_DIRS=(
  ".git"
  "node_modules"
  "vendor"
  "dist"
  "rust-bridge/target"
  ".turbo"
  ".bunlight"
)

# File globs always skipped (lockfiles, build info, big binaries that
# happen to contain the substring).
readonly EXCLUDE_GLOBS=(
  "bun.lock"
  ".tsbuildinfo"
  "*.gguf"
  "*.bin"
  "*.so"
  "*.dll"
  "*.dylib"
  "*.rlib"
  "*.a"
  "*.o"
  "*.gz"
  "*.zip"
  "*.tar"
  "*.png"
  "*.jpg"
  "*.jpeg"
  "*.webp"
  "*.ico"
  "*.pdf"
  "bunlight-mcp"
  "bunlight-engine"
  "bunlight-linux-x64"
)

usage() {
  cat <<EOF
Usage: ${0##*/} [-o output.json] [-h]

Scan the bunlight monorepo for references to "bunlight" (kebab/Pascal/
SCREAMING/snake/npm-scope/FFI/path) and emit a JSON inventory.

Options:
  -o FILE   write JSON to FILE (default: ${OUTPUT_FILE_DEFAULT})
  -h        show this help

Exit codes:
  0 success    1 usage error    2 missing dep    3 scan failure
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

build_rg_args() {
  # Builds the rg argument vector for matches and writes one entry per line
  # to stdout so callers can `mapfile -t` it.
  local pattern="$1"
  local -a args=(
    --no-config
    --no-ignore-vcs
    --hidden
    --files-with-matches
    --count-matches
    -e "${pattern}"
  )
  for d in "${EXCLUDE_DIRS[@]}"; do
    args+=("--glob" "!${d}/**")
  done
  for g in "${EXCLUDE_GLOBS[@]}"; do
    args+=("--glob" "!${g}")
  done
  printf '%s\n' "${args[@]}"
}

# Scan one pattern. Outputs newline-separated lines "PATH:COUNT".
scan_pattern() {
  local pattern="$1"
  local -a args
  mapfile -t args < <(build_rg_args "${pattern}")
  # rg exits 1 when no matches — accept it cleanly.
  rg "${args[@]}" "${REPO_ROOT}" 2>/dev/null || true
}

# Convert "path:count" lines into a JSON array of {path, matches} objects.
# Paths are made relative to REPO_ROOT.
to_files_json() {
  local prefix="${REPO_ROOT%/}/"
  local prefix_len=${#prefix}
  local first=1
  printf '['
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    # rg format: "/abs/path:42"
    local path="${line%:*}"
    local count="${line##*:}"
    local rel="${path:${prefix_len}}"
    if (( first )); then
      first=0
    else
      printf ','
    fi
    # jq -nc handles JSON escaping correctly (no manual escaping).
    jq -nc --arg path "${rel}" --argjson matches "${count}" \
      '{path: $path, matches: $matches}'
  done
  printf ']'
}

# ---- main ---------------------------------------------------------------

main() {
  local output="${OUTPUT_FILE_DEFAULT}"

  while getopts ":o:h" opt; do
    case "${opt}" in
      o) output="${OPTARG}" ;;
      h) usage; exit 0 ;;
      :) printf 'error: option -%s requires an argument\n' "${OPTARG}" >&2; exit 1 ;;
      \?) printf 'error: unknown option -%s\n' "${OPTARG}" >&2; usage >&2; exit 1 ;;
    esac
  done
  shift $((OPTIND - 1))

  require jq
  require rg

  mkdir -p -- "$(dirname -- "${output}")"

  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local git_head
  git_head="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || printf 'unknown')"
  local git_dirty="false"
  if ! git -C "${REPO_ROOT}" diff-index --quiet HEAD -- 2>/dev/null; then
    git_dirty="true"
  fi

  # Per-pattern aggregation kept in associative array.
  declare -A pattern_file_count
  declare -A pattern_occurrence_count

  # Per-file aggregation for the global summary and top-files list.
  declare -A file_total_count
  declare -A file_pattern_hits  # space-separated list of patterns hit

  local total_files=0
  local total_occurrences=0
  local pattern files_count occurrence_count

  for pattern in "${PATTERNS[@]}"; do
    files_count=0
    occurrence_count=0
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      local path="${line%:*}"
      local count="${line##*:}"
      files_count=$(( files_count + 1 ))
      occurrence_count=$(( occurrence_count + count ))

      file_total_count["${path}"]=$(( ${file_total_count["${path}"]:-0} + count ))
      file_pattern_hits["${path}"]="${file_pattern_hits["${path}"]:-} ${pattern}"
    done < <(scan_pattern "${pattern}")

    pattern_file_count["${pattern}"]="${files_count}"
    pattern_occurrence_count["${pattern}"]="${occurrence_count}"
  done

  total_files=${#file_total_count[@]}
  for path in "${!file_total_count[@]}"; do
    total_occurrences=$(( total_occurrences + file_total_count["${path}"] ))
  done

  # --- build JSON --------------------------------------------------------

  # Patterns object
  local patterns_json
  patterns_json="$(
    {
      printf '{'
      local first=1
      for pattern in "${PATTERNS[@]}"; do
        (( first )) && first=0 || printf ','
        jq -nc \
          --arg key "${pattern}" \
          --argjson files "${pattern_file_count[${pattern}]:-0}" \
          --argjson occ "${pattern_occurrence_count[${pattern}]:-0}" \
          '{($key): {file_count: $files, occurrence_count: $occ}}' \
          | sed 's/^{//; s/}$//'
      done
      printf '}'
    }
  )"

  # Per-file array (sorted by descending count then path)
  local prefix="${REPO_ROOT%/}/"
  local prefix_len=${#prefix}
  local files_json
  files_json="$(
    {
      for path in "${!file_total_count[@]}"; do
        local rel="${path:${prefix_len}}"
        printf '%s\t%s\t%s\n' \
          "${file_total_count[${path}]}" \
          "${rel}" \
          "${file_pattern_hits[${path}]# }"
      done | sort -k1,1nr -k2,2 | jq -Rsc '
        split("\n")
        | map(select(length > 0))
        | map(split("\t"))
        | map({
            path: .[1],
            matches: (.[0] | tonumber),
            patterns: (.[2] | split(" ") | unique | sort)
          })
      '
    }
  )"

  local top_files_json
  top_files_json="$(jq -c '.[0:25]' <<<"${files_json}")"

  jq -n \
    --arg tool "bash" \
    --arg version "1.0" \
    --arg timestamp "${timestamp}" \
    --arg repo_root "${REPO_ROOT}" \
    --arg git_head "${git_head}" \
    --argjson git_dirty "${git_dirty}" \
    --argjson patterns "${patterns_json}" \
    --argjson summary_files "${total_files}" \
    --argjson summary_occ "${total_occurrences}" \
    --argjson exclude_dirs "$(printf '%s\n' "${EXCLUDE_DIRS[@]}" | jq -Rsc 'split("\n") | map(select(length>0))')" \
    --argjson files "${files_json}" \
    --argjson top_files "${top_files_json}" \
    '{
      scan_metadata: {
        tool: $tool,
        version: $version,
        timestamp: $timestamp,
        repo_root: $repo_root,
        git_head: $git_head,
        git_dirty: $git_dirty,
        exclude_dirs: $exclude_dirs
      },
      summary: {
        total_files_with_matches: $summary_files,
        total_occurrences: $summary_occ,
        patterns_scanned: ($patterns | length)
      },
      by_pattern: $patterns,
      top_files: $top_files,
      files: $files
    }' \
    >"${output}"

  printf 'wrote %s\n' "${output}" >&2
  printf '  files=%d  occurrences=%d  patterns=%d\n' \
    "${total_files}" "${total_occurrences}" "${#PATTERNS[@]}" >&2
}

main "$@"
