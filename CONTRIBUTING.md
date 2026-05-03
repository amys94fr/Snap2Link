# Contributing to Snap2Link

Thanks for taking the time to contribute! Snap2Link is a small project but every issue, idea, and PR helps make it better. This guide explains how to report problems, propose changes, and submit pull requests so they get reviewed quickly.

## Table of contents

- [Ground rules](#ground-rules)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Development setup](#development-setup)
- [Running the app locally](#running-the-app-locally)
- [Project layout](#project-layout)
- [Tests](#tests)
- [Coding style](#coding-style)
- [Branching and commits](#branching-and-commits)
- [Pull request checklist](#pull-request-checklist)
- [Release process](#release-process)

## Ground rules

- **Be kind.** Treat reviewers, maintainers, and other contributors with the same patience you'd want extended to you.
- **One concern per PR.** Smaller, focused PRs are reviewed and merged faster than monoliths.
- **Discuss before you build** for anything bigger than a typo or trivial fix. Open an issue first so we can agree on the shape of the change.
- **Tests stay green.** PRs that break the test suite will not be merged.

## Reporting bugs

1. **Search existing issues** first — your bug may already be tracked.
2. If it's new, [open a bug report](https://github.com/amys94fr/Snap2Link/issues/new?labels=bug&template=bug_report.md) and include:
   - OS version (e.g. Windows 11 23H2, macOS 14.4)
   - Snap2Link version (Settings → About, or the file name of the installer)
   - Steps to reproduce, in order
   - Expected vs actual behaviour
   - Logs from the dev terminal if you ran `npm run tauri dev`, or screenshots / a short GIF
   - Any error notification text exactly as it appeared

The shorter the reproduction the better. *"Click X then Y, expect Z, got W"* beats a paragraph.

## Suggesting features

1. **Search existing issues and discussions** — your idea may already be on the [roadmap](README.md#%EF%B8%8F-roadmap) or under debate.
2. Open an issue describing:
   - The **problem** (use case in one sentence — *"As a designer reviewing mockups, I want…"*)
   - The **solution you have in mind** (rough sketch, not a final spec)
   - Any **alternatives** you considered

Don't worry about pitching the perfect feature — half of a good idea + an open mind is enough to get the conversation going.

## Development setup

Prerequisites:

- [**Rust**](https://rustup.rs/) (stable channel)
- [**Node.js 20+**](https://nodejs.org/) (LTS recommended)
- [**Tauri CLI v2**](https://v2.tauri.app/start/prerequisites/): `cargo install tauri-cli --version "^2" --locked`
- **Windows-specific:** WebView2 runtime (preinstalled on Windows 11; on Windows 10 see [Microsoft's installer](https://developer.microsoft.com/microsoft-edge/webview2/))
- A `credentials.json` at the repo root if you want OAuth to actually connect to Drive (see [README — Configuration](README.md#-configuration-google-oauth)). Tests do **not** need a real one.

Clone and install:

```bash
git clone https://github.com/amys94fr/Snap2Link
cd Snap2Link
npm install
```

## Running the app locally

```bash
npm run tauri dev
```

Hot reload is enabled for the frontend; Rust changes trigger a recompile (~3–5 s incremental).

Helpful scripts:

```bash
npm run dev         # vite alone (frontend without Tauri runtime — useful for snapshot UI work)
npm run build       # frontend production bundle
npm test            # vitest, single run
npm run test:watch  # vitest in watch mode
npm run typecheck   # tsc --noEmit
```

Rust-only tests:

```bash
cd src-tauri
cargo test --lib
```

To produce a signed installer:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content .\.tauri-keys\snap2link.key -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
# Output: src-tauri/target/release/bundle/nsis/Snap2Link_<version>_x64-setup.exe
```

## Project layout

```
src/                       React + TypeScript frontend
  windows/                   SetupWizard, Settings, About, Overlay, UploaderToast
  components/                HotkeyRecorder, RetentionControl, UpdateChecker
  i18n/                      i18next + locales/en.json
  store/                     Zustand global state
  lib/keyMap.ts              KeyboardEvent <-> Tauri shortcut format
  test/setup.ts              Vitest mocks for @tauri-apps/* APIs

src-tauri/                 Rust backend
  src/commands/              auth, config, drive, screenshot, updater
  src/tray.rs                System tray icon + menu
  src/hotkey.rs              Global shortcut registration
  src/utils.rs               Filesystem paths + debug_log command
  src/lib.rs                 Tauri builder, plugins, invoke handler
  capabilities/default.json  Tauri permissions
  tauri.conf.json            App metadata, windows, bundle config

scripts/
  make_latest_json.ps1       Generates the updater manifest
  make_release_body.ps1      Generates the GitHub release body from CHANGELOG.md

.github/workflows/
  test.yml                   Frontend + backend tests on every push/PR
  release.yml                Build + sign + release on every v* tag
```

## Tests

The codebase ships with **77 frontend tests** (Vitest + Testing Library) and **24 backend tests** (`cargo test --lib`). New behaviour should land with new tests; bug fixes should add a test that would have caught the bug.

### Frontend

- Unit tests for pure helpers (`src/lib/keyMap.ts`, `src/i18n/`, `src/store/`)
- Component tests using React Testing Library + `userEvent` (`src/components/`, `src/windows/`)
- Tauri APIs (`@tauri-apps/api/core`, plugins) are mocked globally in `src/test/setup.ts`. Override per-test with `vi.mocked(invoke).mockImplementation(...)`.

### Backend

- Pure helpers (config (de)serialization, token expiry checks, link formatting, time math) live next to their `#[cfg(test)] mod tests {}` block.
- Anything that touches the network or the OS (`upload_screenshot`, `capture_region`, `tray::setup`) is exercised manually — covering it with unit tests would mostly test Tauri itself. If you find a way to add value there, please do.

### TDD encouraged

The current code was built RED → GREEN → REFACTOR. New features that follow the same loop are easier to review.

## Coding style

### TypeScript / React

- Strict TypeScript (`"strict": true` in `tsconfig.json`). No `any` without a justifying comment.
- Functional components, hooks-based state. Avoid class components.
- Tailwind utilities; reach for `@apply` in `globals.css` only for genuinely repeating patterns.
- Named exports preferred over default for components — easier refactors.
- Keep accessibility in mind: every interactive element should be reachable by keyboard, every icon-only button needs an accessible name.

### Rust

- `cargo fmt` clean (`rustfmt.toml` defaults).
- `cargo clippy --all-targets -- -D warnings` clean.
- Prefer pure functions that take their dependencies as parameters (e.g. `load_config_from(dir: &Path)`) — they're trivially testable and the Tauri-bound wrappers stay thin.
- Errors propagate via `Result<T, String>` for `#[tauri::command]` (Tauri serialises strings cleanly to the frontend), and via `anyhow::Result` for internal helpers.

### Markdown / docs

- 80–100 chars per line is fine; tables can be wider.
- Code blocks always have a language tag (` ```bash`, ` ```rust`, ` ```tsx`).

## Branching and commits

- Branch off `main`. Name your branch `feat/...`, `fix/...`, `docs/...`, `chore/...` — short and descriptive.
- Keep commits **logical, not chronological**. Squash work-in-progress commits before opening a PR.
- Commit subject in **imperative present** (*"Add drag handle"* not *"Added"* or *"Adds"*), under 72 characters.
- Body wraps at 72 characters, explains **why** (the *what* is in the diff).
- Reference the issue number when relevant: `Fix #42 — uploader toast leaks event listener on rapid retries`.

## Pull request checklist

Before clicking *"Ready for review"*, make sure:

- [ ] All tests pass locally (`npm test` and `cargo test --lib`)
- [ ] `npx tsc --noEmit` is clean
- [ ] `cargo clippy --all-targets -- -D warnings` is clean (if you touched Rust)
- [ ] You added tests for new behaviour or regression coverage for fixes
- [ ] You updated `CHANGELOG.md` under the `## [Unreleased]` section if there's user-visible impact
- [ ] You updated `docs/` and `README.md` if you changed user-facing flows
- [ ] The PR description explains **what** changed and **why**, and links the originating issue
- [ ] UI changes include a before / after screenshot or short GIF

CI ([`test.yml`](.github/workflows/test.yml)) will run automatically. Wait for it to go green before pinging for review.

## Release process

Releases are cut by the maintainer and fully automated through GitHub Actions. The workflow is documented in [**docs/RELEASE.md**](docs/RELEASE.md). In short: bump the version in `package.json`, `Cargo.toml`, and `tauri.conf.json`, add a `CHANGELOG.md` entry, push a `vX.Y.Z` tag, and the rest happens by itself (signed installer, GitHub release, optional winget bump).

## Questions?

Open a [discussion](https://github.com/amys94fr/Snap2Link/discussions) (preferred for design / roadmap questions) or an [issue](https://github.com/amys94fr/Snap2Link/issues) for anything actionable.

Thanks again for contributing!
