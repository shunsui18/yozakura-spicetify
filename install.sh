#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║           Yozakura — Spicetify Installer                         ║
# ║           github.com/shunsui18/spicetify                         ║
# ╚══════════════════════════════════════════════════════════════════╝
set -euo pipefail

# ─── Colour / tput setup ─────────────────────────────────────────────────────
if [[ -t 2 ]] && command -v tput &>/dev/null && tput setaf 1 &>/dev/null; then
  _RST="$(tput sgr0)"
  _BLD="$(tput bold)"
  _DIM="$(tput dim)"
  _RED="$(tput setaf 1)"
  _GRN="$(tput setaf 2)"
  _YLW="$(tput setaf 3)"
  _BLU="$(tput setaf 4)"
  _MAG="$(tput setaf 5)"
  _CYN="$(tput setaf 6)"
  _WHT="$(tput setaf 7)"
  _PNK="$(tput setaf 205)"
  _LAV="$(tput setaf 183)"
else
  _RST='' _BLD='' _DIM='' _RED='' _GRN='' _YLW='' _BLU=''
  _MAG='' _CYN='' _WHT='' _PNK='' _LAV=''
fi

# ─── Output helpers (all to stderr) ──────────────────────────────────────────
info()    { printf >&2 "  ${_BLU}❀${_RST}  %s\n"        "$*"; }
success() { printf >&2 "  ${_GRN}✓${_RST}  %s\n"        "$*"; }
warn()    { printf >&2 "  ${_YLW}⚠${_RST}  %s\n"        "$*"; }
err()     { printf >&2 "  ${_RED}✗${_RST}  %s\n"        "$*"; exit 1; }
prompt()  { printf >&2 "  ${_PNK}❀${_RST}  %s "         "$*"; }
step()    { printf >&2 "\n  ${_LAV}${_BLD}▸${_RST}  %s\n" "$*"; }

# ─── Banner ──────────────────────────────────────────────────────────────────
banner() {
  printf >&2 "\n"
  printf >&2 "  ${_MAG}${_BLD}╭──────────────────────────────────────────────╮${_RST}\n"
  printf >&2 "  ${_MAG}${_BLD}│${_RST}        ${_PNK}${_BLD}夜桜  Yozakura — Spicetify${_RST}            ${_MAG}${_BLD}│${_RST}\n"
  printf >&2 "  ${_MAG}${_BLD}│${_RST}     ${_DIM}github.com/shunsui18/spicetify${_RST}           ${_MAG}${_BLD}│${_RST}\n"
  printf >&2 "  ${_MAG}${_BLD}╰──────────────────────────────────────────────╯${_RST}\n"
  printf >&2 "\n"
}

# ─── Constants ───────────────────────────────────────────────────────────────
SPICE_CFG_DIR="${HOME}/.config/spicetify"
THEMES_DEST="${SPICE_CFG_DIR}/Themes"
EXTS_DEST="${SPICE_CFG_DIR}/Extensions"
GITHUB_RAW="https://raw.githubusercontent.com/shunsui18/spicetify/main"

VALID_THEMES=(yoru hiru)
VALID_ACCENTS=(Base Lantern Blush Petal Iris Wisteria Indigo Harbour Sky Seafoam Moss Starlight Amber Ember Crimson Bloom Moon)

# ─── Invocation-mode detection ───────────────────────────────────────────────
# When run via bash <(curl ...), BASH_SOURCE[0] resolves to /proc/self/fd/<n>
# and is not a real path we can walk up from.
SRC="${BASH_SOURCE[0]}"
if [[ -f "$SRC" ]] && [[ "$SRC" != /proc/* ]]; then
  MODE="local"
  REPO_DIR="$(cd "$(dirname "$SRC")" && pwd)"
else
  MODE="remote"
  REPO_DIR=""
fi

# ─── Remote asset fetching ───────────────────────────────────────────────────
TMPDIR_REMOTE=""

fetch_remote_assets() {
  local flavor="$1"
  TMPDIR_REMOTE="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_REMOTE"' EXIT

  info "Fetching theme assets from GitHub…"

  local theme_dir="${TMPDIR_REMOTE}/Themes/yozakura-${flavor}"
  local ext_dir="${TMPDIR_REMOTE}/Extensions"
  mkdir -p "$theme_dir" "$ext_dir"

  local base="${GITHUB_RAW}"
  curl -fsSL "${base}/Themes/yozakura-${flavor}/color.ini" -o "${theme_dir}/color.ini" \
    || err "Failed to fetch color.ini"
  curl -fsSL "${base}/Themes/yozakura-${flavor}/user.css"  -o "${theme_dir}/user.css"  \
    || err "Failed to fetch user.css"
  curl -fsSL "${base}/Extensions/yozakura-${flavor}-switcher.js" \
    -o "${ext_dir}/yozakura-${flavor}-switcher.js" \
    || err "Failed to fetch switcher extension"

  REPO_DIR="$TMPDIR_REMOTE"
  success "Assets downloaded."
}

# ─── Argument parsing ─────────────────────────────────────────────────────────
ARG_THEME=""
ARG_ACCENT=""

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --theme)
        [[ -z "${2:-}" ]] && err "--theme requires a value (yoru|hiru)"
        ARG_THEME="${2,,}"   # lowercase
        shift 2
        ;;
      --accent)
        [[ -z "${2:-}" ]] && err "--accent requires a value"
        ARG_ACCENT="$2"
        shift 2
        ;;
      -h|--help)
        printf >&2 "Usage: install.sh [--theme yoru|hiru] [--accent <name>]\n"
        printf >&2 "Accents: %s\n" "${VALID_ACCENTS[*]}"
        exit 0
        ;;
      *)
        err "Unknown option: $1"
        ;;
    esac
  done
}

# ─── Validation helpers ───────────────────────────────────────────────────────
validate_theme() {
  local t="$1"
  for v in "${VALID_THEMES[@]}"; do
    [[ "$t" == "$v" ]] && return 0
  done
  return 1
}

# Returns the properly-cased accent name, or empty string if invalid
normalise_accent() {
  local input="${1,,}"   # lowercase input for comparison
  for v in "${VALID_ACCENTS[@]}"; do
    if [[ "${v,,}" == "$input" ]]; then
      printf '%s' "$v"
      return 0
    fi
  done
  return 1
}

# ─── Dependency check ─────────────────────────────────────────────────────────
check_deps() {
  if ! command -v spicetify &>/dev/null; then
    warn "spicetify not found in PATH."
    info  "Install it from: https://spicetify.app/docs/getting-started"
    err  "Please install spicetify and re-run."
  fi
  if [[ "$MODE" == "remote" ]] && ! command -v curl &>/dev/null; then
    err "curl is required for remote installation."
  fi
}

# ─── Interactive menus ────────────────────────────────────────────────────────
menu_theme() {
  printf >&2 "\n"
  printf >&2 "  ${_MAG}${_BLD}╭─ Choose a flavour ──────────────────────────╮${_RST}\n"
  printf >&2 "  ${_MAG}${_BLD}│${_RST}   ${_BLD}1)${_RST}  ${_BLD}Yoru${_RST} ${_DIM}(夜 · night · dark)${_RST}              ${_MAG}${_BLD}│${_RST}\n"
  printf >&2 "  ${_MAG}${_BLD}│${_RST}   ${_BLD}2)${_RST}  ${_BLD}Hiru${_RST} ${_DIM}(昼 · day  · light)${_RST}              ${_MAG}${_BLD}│${_RST}\n"
  printf >&2 "  ${_MAG}${_BLD}╰─────────────────────────────────────────────╯${_RST}\n"
  printf >&2 "\n"

  local choice
  while true; do
    prompt "Flavour [1/2]:"
    read -r choice
    case "$choice" in
      1) printf 'yoru'; return ;;
      2) printf 'hiru'; return ;;
      *) warn "Enter 1 or 2." ;;
    esac
  done
}

menu_accent() {
  printf >&2 "\n"
  printf >&2 "  ${_MAG}${_BLD}╭─ Choose an accent ──────────────────────────╮${_RST}\n"
  local i=0
  for acc in "${VALID_ACCENTS[@]}"; do
    i=$(( i + 1 ))
    printf >&2 "  ${_MAG}${_BLD}│${_RST}   ${_BLD}%2d)${_RST}  %-12s" "$i" "$acc"
    if (( i % 2 == 0 )); then
      printf >&2 "   ${_MAG}${_BLD}│${_RST}\n"
    fi
  done
  # If odd number of accents, close the last line
  if (( ${#VALID_ACCENTS[@]} % 2 != 0 )); then
    printf >&2 "             ${_MAG}${_BLD}│${_RST}\n"
  fi
  printf >&2 "  ${_MAG}${_BLD}╰─────────────────────────────────────────────╯${_RST}\n"
  printf >&2 "\n"

  local choice
  while true; do
    prompt "Accent [1-${#VALID_ACCENTS[@]}]:"
    read -r choice
    if [[ "$choice" =~ ^[0-9]+$ ]] \
        && (( choice >= 1 && choice <= ${#VALID_ACCENTS[@]} )); then
      printf '%s' "${VALID_ACCENTS[$((choice - 1))]}"
      return
    else
      warn "Enter a number between 1 and ${#VALID_ACCENTS[@]}."
    fi
  done
}

# ─── Extension deregistration ────────────────────────────────────────────────
# Reads config-xpui.ini to find any currently registered yozakura extension
# and deregisters it (trailing-dash syntax) before we add the new one.
# Handles three cases:
#   • same flavor reinstall   → deregister so spicetify doesn't stack duplicates
#   • opposite flavor active  → deregister the other switcher cleanly
#   • no yozakura ext active  → no-op
remove_old_extension() {
  local incoming_ext="$1"   # e.g. yozakura-hiru-switcher.js
  local cfg_file="${SPICE_CFG_DIR}/config-xpui.ini"

  if [[ ! -f "$cfg_file" ]]; then
    return 0   # No spicetify config yet — nothing to clean up
  fi

  # Extract the extensions value; spicetify stores them pipe-separated when
  # multiple are active: extensions = foo.js|bar.js
  local ext_line
  ext_line="$(grep -i '^\s*extensions\s*=' "$cfg_file" 2>/dev/null || true)"
  [[ -z "$ext_line" ]] && return 0

  local found_ext=""
  for candidate in yozakura-yoru-switcher.js yozakura-hiru-switcher.js; do
    if printf '%s\n' "$ext_line" | grep -q "$candidate"; then
      found_ext="$candidate"
      break
    fi
  done

  [[ -z "$found_ext" ]] && return 0   # No yozakura extension registered

  if [[ "$found_ext" == "$incoming_ext" ]]; then
    info "Re-installing ${_BLD}${found_ext}${_RST} — deregistering first…"
  else
    info "Removing existing extension: ${_BLD}${found_ext}${_RST}"
  fi

  # The trailing dash tells spicetify to remove the entry
  spicetify config extensions "${found_ext}-"
  success "Deregistered ${_BLD}${found_ext}${_RST}"
}

# ─── Install logic ─────────────────────────────────────────────────────────────
do_install() {
  local flavor="$1"
  local accent="$2"
  local theme_name="yozakura-${flavor}"
  local ext_name="yozakura-${flavor}-switcher.js"

  # Fetch remote assets if needed (must happen before path checks)
  if [[ "$MODE" == "remote" ]]; then
    fetch_remote_assets "$flavor"
  fi

  local src_theme="${REPO_DIR}/Themes/${theme_name}"
  local src_ext="${REPO_DIR}/Extensions/${ext_name}"

  [[ -d "$src_theme" ]] || err "Theme source not found: $src_theme"
  [[ -f "$src_ext"   ]] || err "Extension source not found: $src_ext"

  # ── Deregister any existing yozakura extension ──
  step "Checking for existing Yozakura extension…"
  remove_old_extension "$ext_name"

  # ── Create destination directories ──
  step "Preparing directories…"
  mkdir -p "${THEMES_DEST}/${theme_name}"
  mkdir -p "${EXTS_DEST}"
  success "Destination directories ready."

  # ── Copy theme files ──
  step "Installing theme files…"
  cp "${src_theme}/color.ini" "${THEMES_DEST}/${theme_name}/color.ini"
  cp "${src_theme}/user.css"  "${THEMES_DEST}/${theme_name}/user.css"
  success "Theme files copied  →  ${THEMES_DEST}/${theme_name}/"

  # ── Copy extension ──
  step "Installing extension…"
  cp "${src_ext}" "${EXTS_DEST}/${ext_name}"
  success "Extension copied    →  ${EXTS_DEST}/${ext_name}"

  # ── Configure spicetify ──
  step "Configuring spicetify…"
  spicetify config current_theme  "$theme_name"
  spicetify config color_scheme   "$accent"
  spicetify config extensions     "$ext_name"
  success "Theme      : ${_BLD}${theme_name}${_RST}"
  success "Accent     : ${_BLD}${accent}${_RST}"
  success "Extension  : ${_BLD}${ext_name}${_RST}"

  # ── Apply ──
  step "Applying…"
  spicetify apply
  success "Done! Yozakura ${_BLD}${flavor}${_RST} · ${_BLD}${accent}${_RST} is now active."

  printf >&2 "\n"
  printf >&2 "  ${_DIM}Tip: switch accent anytime with${_RST}\n"
  printf >&2 "  ${_DIM}  spicetify config color_scheme <Accent> && spicetify apply${_RST}\n"
  printf >&2 "\n"
}

# ─── Main ──────────────────────────────────────────────────────────────────────
main() {
  parse_args "$@"
  banner
  check_deps

  # ── Resolve theme ──
  local flavor
  if [[ -n "$ARG_THEME" ]]; then
    validate_theme "$ARG_THEME" || err "Invalid theme '${ARG_THEME}'. Choose: yoru, hiru"
    flavor="$ARG_THEME"
    info "Theme: ${_BLD}${flavor}${_RST}"
  else
    flavor="$(menu_theme)"
  fi

  # ── Resolve accent ──
  local accent
  if [[ -n "$ARG_ACCENT" ]]; then
    accent="$(normalise_accent "$ARG_ACCENT")" \
      || err "Invalid accent '${ARG_ACCENT}'. Valid: ${VALID_ACCENTS[*]}"
    info "Accent: ${_BLD}${accent}${_RST}"
  else
    accent="$(menu_accent)"
  fi

  do_install "$flavor" "$accent"
}

main "$@"
