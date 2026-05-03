# Changelog

All notable changes to Snap2Link are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
