# Changelog

All notable changes to Snap2Link are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
