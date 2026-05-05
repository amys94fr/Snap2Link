# Changelog

All notable changes to Snap2Link are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] – 2026-05-05

### Added — In-app annotation editor

After every region capture, Snap2Link now asks **"What now?"** with two clear paths:

- 📝 **Edit** — opens a full annotation editor with a canvas (Konva-backed) loaded with the screenshot. Tools on the left toolbar:
  - **Select** (`V`) — click any placed shape to select it (blue glow), drag to move, `Delete` / `Backspace` to remove. Click empty canvas to deselect.
  - **Pen** (`P`) — freeform polyline.
  - **Rectangle** (`R`) — click-and-drag rectangle.
  - **Circle / Oval** (`O`) — click-and-drag ellipse.
  - **Arrow** (`A`) — click-and-drag arrow with a head sized from the stroke preset.
  - **Text** (`T`) — click to place, inline textarea, commit with `Enter` or click-away. Empty text drops the placeholder.
  - **Blur** (`B`) — click-and-drag a region; a Gaussian blur is applied to the source image cropped to that rectangle. Intensity is driven by the stroke preset. Icon is a water droplet — the universal blur metaphor.
  - 6-swatch colour palette + native HTML5 custom picker.
  - 3 stroke widths, also driving text size and blur radius.
  - Undo / Redo (`Ctrl+Z` / `Ctrl+Y`, history capped at 50).
- 📤 **Save & share** — uploads the screenshot directly without annotating (the v1.2.0 default flow). Same speed as before.
- `Esc` from the prompt cancels everything.

The `Edit` flow exports the Konva stage at native (un-scaled) resolution so the upload keeps the original sharpness even if the canvas was downscaled to fit. On `Done` the annotator window dismisses immediately, hands the annotated PNG path off to the overlay, and the same centered toast (`Uploading… → Link copied!`) the legacy flow used confirms the upload.

### Changed

- The post-capture flow now always asks Edit / Save (no more global toggle in Settings — the choice is per screenshot).
- The overlay window owns the upload + toast for both Save and Done, so the toast never visually overlaps the editor.
- `tauri = features += [protocol-asset]` and `tauri.conf.json` declares an asset-protocol scope so the captured PNG can be loaded into the editor's webview via `convertFileSrc`.

### Internals

- New backend command `write_annotated_image(bytes)` saves the PNG bytes the editor exports to a temp file (used as the input to the existing `upload_screenshot`).
- New `annotator` Tauri window (decorated, 1100×760, hidden by default, opened on-demand via `WebviewWindow.getByLabel`).
- Bundled deps: `konva` 10, `react-konva` 19. Bundle grew from 280 KB to ~604 KB JS — within the desktop budget.
- 47 new frontend tests (annotator store + canvas + toolbar + window) + 2 new backend tests.

## [1.2.0] – 2026-05-04

### Changed — Modern stack refresh

Every direct dependency bumped to the latest stable major. No behaviour change for end users, but the codebase is now on the current line of every framework so future security patches and feature work land on a supported baseline.

#### Frontend

- **Tailwind CSS 3 → 4.** The PostCSS plugin moved to a separate package — installer/build now go through `@tailwindcss/postcss`, autoprefixer dropped (Tailwind 4 ships its own vendor-prefixing via Lightning CSS). Custom `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-success` classes migrated from `@layer components` to the new `@utility` directive (Tailwind 4 no longer auto-registers component-layer classes for `@apply`). CSS entry switched from `@tailwind base/components/utilities` to `@import "tailwindcss"` + `@config "../../tailwind.config.js"` so the existing colour palette (`brand`, `success`, `danger`, custom slate) is preserved.
- **TypeScript 5 → 6.** Compiles cleanly under strict mode. `tsconfig.json`'s deprecated `baseUrl` removed in favour of relative-anchored `paths` (`./src/*`).
- **react-i18next 15 → 17.** Picks up i18next 26 and broadens its TypeScript peer to `^5 || ^6`, which is what unblocked the TS bump.
- **jsdom 25 → 29**, **@types/node 22 → 25** (testing infra).
- All `@tauri-apps/*` plugin packages bumped to their latest 2.x release (api 2.11, plugin-autostart 2.5, plugin-clipboard-manager 2.3, plugin-global-shortcut 2.3, plugin-notification 2.3, plugin-shell 2.3).
- All `@testing-library/*` bumped (jest-dom 6.9, react 16.3, user-event 14.6) and `postcss` 8.5.

#### Backend

- **reqwest 0.12 → 0.13.** Renamed the `rustls-tls` feature to `rustls`; the `form` and `query` extensions are now opt-in and explicitly enabled.
- `cargo update` ran across the rest of the tree, picking up the latest minors of every Tauri plugin, `tokio`, `serde`, `chrono`, `image`, `xcap`, `thiserror`, etc.

#### CI

- `actions/upload-artifact` 4 → 7 and `actions/download-artifact` 4 → 8 in the release workflow.

### Internals

- Repository now ships a `.gitattributes` enforcing LF endings on `*.sh` and `*.mjs` (so `scripts/install.sh` keeps its shebang clean when cloned on Windows).
- New `scripts/install.sh` — one-liner Linux installer (`curl -fsSL .../install.sh | bash`) that auto-detects apt/dnf/zypper and falls back to the AppImage.

## [1.1.0] – 2026-05-03

### Added

- **macOS support** — Apple Silicon (`aarch64`) and Intel (`x86_64`) builds
  are now produced by CI for every release. Distributed unsigned for now,
  so the first launch needs a manual *right-click → Open* in Finder.
- **Linux support** — `.AppImage` (portable), `.deb` (Debian/Ubuntu) and
  `.rpm` (Fedora/RHEL) packages, all signed for the in-app updater.
- The release workflow now builds across a 4-runner matrix (Windows,
  macOS ARM, macOS Intel, Ubuntu) in parallel and aggregates everything
  into a single GitHub release with a multi-platform `latest.json`.

### Changed

- `make_latest_json.ps1` and `make_release_body.ps1` rewritten in Node
  (`.mjs`) so they can run on the Linux release-aggregator runner.
- `tauri.conf.json` declares the Linux `.deb` runtime dependencies
  (`libwebkit2gtk-4.1-0`, `libayatana-appindicator3-1`) and enables
  `bundleMediaFramework` for the AppImage so it's truly portable.

### Known issues

- Without an Apple Developer ID certificate, macOS Gatekeeper blocks the
  first launch — workaround: right-click the app in Finder → *Open*.
  Notarisation tracked separately; see [docs/RELEASE.md](docs/RELEASE.md).
- The `glib` `VariantStrIter` unsoundness (RUSTSEC) is a Linux-only
  transitive coming from `wry` → `webkit2gtk`. We have not been able to
  bump it without bumping Tauri itself; will revisit when an upstream fix
  lands.

## [1.0.2] – 2026-05-03

### Security

- Bumped Vite to 8.x and Vitest to 4.x, which transitively pulls
  fixed esbuild and rolldown. This silences the
  [GHSA-67mh-4wv8-2f99] (Vite path traversal in dev-only `.map`
  handler) and [GHSA-67mh-4wv8-2f99] (esbuild dev server CSRF)
  Dependabot alerts. Both vulnerabilities only affected
  `npm run dev`, not the released binary.

### Changed

- Upgraded React 18 → 19, Zustand 4 → 5, Vitest 2 → 4, Vite 5 → 8.
  No behavioural changes — covered by the existing 77-test frontend
  suite.
- Upgraded Rust deps: `xcap` 0.0.14 → 0.9.4 (rewrote the screenshot
  helper to handle xcap's new `Result`-returning monitor accessors)
  and `dirs` 5 → 6.
- GitHub Actions bumped to v6 (`checkout`, `setup-node`) and v3
  (`softprops/action-gh-release`).

[GHSA-67mh-4wv8-2f99]: https://github.com/advisories/GHSA-67mh-4wv8-2f99

## [1.0.1] – 2026-05-03

### Fixed

- The bundled installer placed `credentials.json` in a `_up_/` subfolder
  (because the Tauri resource path started with `../`), but the runtime
  lookup didn't know about it, so a fresh install showed
  *"Error: credentials.json not found"* in Settings and the OAuth flow
  was unreachable. The OAuth client secret is now embedded at compile
  time via `include_str!`, removing the resource-dir lookup entirely.

## [1.0.0] – 2026-05-03

### Added

- Region-selection overlay (fullscreen, drag to capture, ESC to cancel) with
  live size readout.
- Google Drive upload via OAuth 2.0 — captures land in a `Snap2Link` folder
  and a public direct-download link is copied to the clipboard.
- System tray icon with `Take Screenshot · Settings · Check for Updates ·
  About · Quit` menu.
- Configurable global hotkey (default `Ctrl+PrintScreen`) handled by
  `tauri-plugin-global-shortcut`.
- Settings window: switch Google account, change hotkey, configure
  auto-delete retention, toggle "Start with Windows".
- Native notifications and an in-app centered toast that turns into a green
  checkmark once the link reaches the clipboard.
- Built-in updater (`tauri-plugin-updater`) — Settings → Check for Updates
  pulls the signed manifest from GitHub Releases.
- Setup wizard for first-run OAuth handling.
- About window with version, author, GitHub link, and full MIT licence text.
- i18n engine (i18next) with English bundled; new locales drop in by
  copying `src/i18n/locales/en.json`.

### Engineering

- TDD-first: 77 frontend tests (Vitest + Testing Library) + 24 backend
  tests (`cargo test --lib`).
- Pure helpers split out from Tauri-bound commands so the OAuth flow,
  Drive API, hotkey parsing, and config persistence are all tested in
  isolation.

[1.0.0]: https://github.com/amys94fr/Snap2Link/releases/tag/v1.0.0
