#!/usr/bin/env bash
# Installs a recent PipeWire for the Linux builds on Ubuntu 22.04.
#
# On Linux, xcap always depends on the pipewire crate, whose bindings don't
# compile against the PipeWire 0.3.48 that Ubuntu 22.04 ships. Only xcap's video
# recorder uses it, and Snap2Link doesn't: the app doesn't link libpipewire, so
# this is needed to compile and nothing from it ends up in the bundles.
#
# Needs meson and ninja-build.

set -euo pipefail

# Tag 1.6.11. Pinned by commit because a tag can move.
PIPEWIRE_COMMIT=4287f31510771fc999f8a58a024c81ca10b8d55f

SRC=$(mktemp -d)
git -C "$SRC" init -q
git -C "$SRC" fetch -q --depth 1 https://github.com/PipeWire/pipewire.git "$PIPEWIRE_COMMIT"
git -C "$SRC" checkout -q FETCH_HEAD

meson setup "$SRC/build" "$SRC" \
  --prefix=/usr/local \
  --buildtype=release \
  --wrap-mode=nofallback \
  -Dauto_features=disabled \
  -Dexamples=disabled \
  -Dtests=disabled \
  -Dman=disabled \
  -Ddocs=disabled \
  -Dsession-managers=[] \
  -Dpipewire-alsa=disabled \
  -Dpipewire-jack=disabled
sudo ninja -C "$SRC/build" install
sudo ldconfig
pkg-config --modversion libpipewire-0.3
