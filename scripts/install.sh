#!/usr/bin/env bash
#
# Snap2Link Linux installer
# Usage: curl -fsSL https://raw.githubusercontent.com/amys94fr/Snap2Link/main/scripts/install.sh | bash
#
# Detects your distro, downloads the latest release from GitHub, and installs it.
# Falls back to the portable AppImage if no native package fits your system.

set -euo pipefail

REPO="amys94fr/Snap2Link"
APP_NAME="Snap2Link"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"

# ---------- pretty output ----------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

info()  { echo "${BOLD}==>${RESET} $*"; }
warn()  { echo "${YELLOW}${BOLD}!${RESET} $*" >&2; }
fail()  { echo "${RED}${BOLD}✗${RESET} $*" >&2; exit 1; }
ok()    { echo "${GREEN}${BOLD}✓${RESET} $*"; }

# ---------- preflight ----------
[[ "$(uname -s)" == "Linux" ]] || fail "This script is for Linux. See README for macOS/Windows."

ARCH="$(uname -m)"
[[ "$ARCH" == "x86_64" ]] || fail "Unsupported architecture: $ARCH (only x86_64 is built today)."

for cmd in curl grep sed; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
done

# ---------- detect package manager ----------
PKG_KIND=""
if   command -v apt-get >/dev/null 2>&1; then PKG_KIND="deb"
elif command -v dnf     >/dev/null 2>&1; then PKG_KIND="rpm"
elif command -v zypper  >/dev/null 2>&1; then PKG_KIND="rpm"
else                                          PKG_KIND="appimage"
fi

info "Detected package format: ${BOLD}${PKG_KIND}${RESET}"

# ---------- pick the right asset ----------
case "$PKG_KIND" in
  deb)      ASSET_PATTERN='_amd64\.deb$' ;;
  rpm)      ASSET_PATTERN='\.x86_64\.rpm$' ;;
  appimage) ASSET_PATTERN='_amd64\.AppImage$' ;;
esac

info "Fetching latest release info from GitHub…"
RELEASE_JSON="$(curl -fsSL "$GITHUB_API")" || fail "Could not reach GitHub API."

ASSET_URL="$(echo "$RELEASE_JSON" \
  | grep -oE '"browser_download_url": *"[^"]+"' \
  | sed -E 's/.*"(https[^"]+)".*/\1/' \
  | grep -E "$ASSET_PATTERN" \
  | head -n 1)"

[[ -n "${ASSET_URL:-}" ]] || fail "No matching asset found for pattern: $ASSET_PATTERN"

ASSET_NAME="$(basename "$ASSET_URL")"
VERSION="$(echo "$RELEASE_JSON" | grep -oE '"tag_name": *"[^"]+"' | sed -E 's/.*"([^"]+)".*/\1/')"
ok "Found ${BOLD}${APP_NAME} ${VERSION}${RESET} → ${ASSET_NAME}"

# ---------- download ----------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

info "Downloading…"
curl -fL --progress-bar -o "${TMP_DIR}/${ASSET_NAME}" "$ASSET_URL"
ok "Downloaded to ${TMP_DIR}/${ASSET_NAME}"

# ---------- install ----------
need_sudo() {
  if [[ "$EUID" -eq 0 ]]; then echo ""; else echo "sudo"; fi
}

case "$PKG_KIND" in
  deb)
    SUDO="$(need_sudo)"
    info "Installing with apt (will resolve dependencies automatically)…"
    $SUDO apt-get update -qq || warn "apt-get update failed, continuing anyway"
    $SUDO apt-get install -y "${TMP_DIR}/${ASSET_NAME}"
    ok "Installed. Launch with: ${BOLD}snap2link${RESET}  (or find it in your app menu)"
    ;;

  rpm)
    SUDO="$(need_sudo)"
    if command -v dnf >/dev/null 2>&1; then
      info "Installing with dnf…"
      $SUDO dnf install -y "${TMP_DIR}/${ASSET_NAME}"
    else
      info "Installing with zypper…"
      $SUDO zypper --non-interactive install --allow-unsigned-rpm "${TMP_DIR}/${ASSET_NAME}"
    fi
    ok "Installed. Launch with: ${BOLD}snap2link${RESET}  (or find it in your app menu)"
    ;;

  appimage)
    INSTALL_DIR="${HOME}/.local/bin"
    mkdir -p "$INSTALL_DIR"
    DEST="${INSTALL_DIR}/snap2link.AppImage"
    mv "${TMP_DIR}/${ASSET_NAME}" "$DEST"
    chmod +x "$DEST"
    ok "Installed to ${BOLD}${DEST}${RESET}"
    if ! echo ":$PATH:" | grep -q ":${INSTALL_DIR}:"; then
      warn "${INSTALL_DIR} is not in your PATH. Add this to your shell rc file:"
      echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    echo "    Launch with: ${BOLD}snap2link.AppImage${RESET}"
    warn "Tray icon needs libayatana-appindicator3-1 — install it via your package manager if missing."
    ;;
esac

echo
ok "Done. First launch will prompt you to connect Google Drive."
