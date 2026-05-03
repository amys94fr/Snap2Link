<div align="center">

<img src="src-tauri/icons/icon.png" alt="Snap2Link" width="128" />

# 📸 Snap2Link

**Screenshot → Google Drive → Clipboard, in under a second.**

[![Release](https://img.shields.io/github/v/release/amys94fr/Snap2Link?style=flat-square&color=22c55e)](https://github.com/amys94fr/Snap2Link/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/amys94fr/Snap2Link/total?style=flat-square&color=3b82f6)](https://github.com/amys94fr/Snap2Link/releases)
[![Stars](https://img.shields.io/github/stars/amys94fr/Snap2Link?style=flat-square&color=f59e0b)](https://github.com/amys94fr/Snap2Link/stargazers)
[![License](https://img.shields.io/github/license/amys94fr/Snap2Link?style=flat-square&color=64748b)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/amys94fr/Snap2Link/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/amys94fr/Snap2Link/actions)

</div>

> A tiny tray-resident Windows app that captures a screen region, uploads it to **your** Google Drive, and drops a public share link straight into your clipboard. No web service in between, no manual steps, no bookmarklet to fish out.

<p align="center">
  <!--
    Drop a screen recording here.
    The fastest way: ScreenToGif (https://www.screentogif.com/)
    record 5-8 seconds → "Save as → GIF" → place under docs/snap2link-demo.gif
    Then this image will resolve.
  -->
  <img src="docs/snap2link-demo.gif" alt="Snap2Link demo" width="720" />
</p>

---

## ✨ Features

| | |
|---|---|
| 🖱️ **Drag-to-capture overlay** | Fullscreen, semi-transparent, live size readout, ESC to cancel |
| ⚡ **Instant share link** | Upload → make public → clipboard, all in the background, < 1 s on broadband |
| ⌨️ **Global hotkey** | Default `Ctrl + Print Screen`, fully rebindable from Settings |
| 🗂️ **Auto-cleanup on Drive** | Deletes screenshots older than *N* days (default 30) — your Drive stays tidy |
| 🚀 **Built-in auto-updater** | Signed updates pulled from GitHub Releases — Settings → Check for Updates |
| 🪟 **Start with Windows** | Toggle from Settings — always one keystroke away |
| 🔒 **No third-party server** | OAuth straight to your Drive. Your screenshots, your account, no middleman |
| 🌍 **i18n-ready** | English bundled; add a locale by translating a single JSON file |

## 🚀 Quick Start

```powershell
# 1 · Install
winget install snap2link

# 2 · Launch → wizard → "Connect Google Drive" → grant access in your browser

# 3 · Press Ctrl+PrintScreen → drag a region → paste anywhere
```

That's it. Three steps, zero configuration.

## 📦 Installation

### Via winget *(recommended, Windows 10+)*

```powershell
winget install snap2link
# or, fully qualified:
winget install amys94fr.Snap2Link
```

### Direct download

Grab the latest installer from the [Releases page](https://github.com/amys94fr/Snap2Link/releases/latest). Windows SmartScreen may flag the binary as *"unrecognised app"* (not yet EV-code-signed) — click **More info → Run anyway**.

### Build from source

You'll need [Rust](https://rustup.rs/) (stable), [Node.js 20+](https://nodejs.org/), and the Tauri CLI (`cargo install tauri-cli --version "^2"`).

```bash
git clone https://github.com/amys94fr/Snap2Link
cd Snap2Link
npm install
npm run tauri dev      # hot-reload dev build
npm run tauri build    # produces a signed installer in src-tauri/target/release/bundle/
```

## 🔧 Configuration (Google OAuth)

**End users have nothing to configure.** The first launch opens a browser tab on Google's consent page; pick your account; you're done.

**For developers / forks** wanting to ship under their own OAuth credentials:

1. Create a project on [console.cloud.google.com](https://console.cloud.google.com/)
2. Enable the **Google Drive API**
3. Credentials → Create OAuth client → **Desktop application**
4. Download the JSON, rename it `credentials.json`, drop it at the repo root *(gitignored)*
5. `npm run tauri build`

Snap2Link only requests the minimum scopes:

| Scope | Why |
|---|---|
| `drive.file` | Read/write **only the files Snap2Link itself creates** — never the rest of your Drive |
| `userinfo.email` | Display the connected account in Settings (so "Switch Account" makes sense) |

## 💡 Use Cases

- **Bug reports** — capture the broken UI, paste the link in Jira / GitHub Issues
- **Design feedback** — share mockup snippets in Slack / Discord / Notion in seconds
- **Documentation** — drop image links straight into READMEs, blog posts, support tickets
- **Remote support** — guide a colleague through their screen without launching a screen-share session
- **AI workflows** — paste the link directly into Claude / ChatGPT / Cursor when you need visual context for a prompt
- **Meeting notes** — snap a slide, link it next to your notes, move on with the meeting

## 🛣️ Roadmap

- [x] Region capture · OAuth Drive · clipboard · auto-cleanup · hotkey · tray
- [x] Auto-updater (signed releases via GitHub)
- [x] winget distribution
- [ ] **macOS support** (Tauri code is cross-platform; needs real-world testing on Mac)
- [ ] **In-app annotations** before upload — arrows, blur, text, highlight
- [ ] **History pane** — last *N* screenshots with thumbnails and quick re-share
- [ ] **More clouds** — Dropbox, OneDrive, S3-compatible
- [ ] **Full-screen / window-bound capture modes** alongside region selection
- [ ] **More locales** — French, Spanish, German, Portuguese …

Got an idea? [Open an issue](https://github.com/amys94fr/Snap2Link/issues/new) — I read every one.

## 🤝 Contributing

PRs welcome. To get a working dev environment:

```bash
git clone https://github.com/amys94fr/Snap2Link
cd Snap2Link
npm install
npm test                     # 77 frontend tests (Vitest + Testing Library)
cd src-tauri && cargo test --lib   # 24 backend tests
```

CI ([`test.yml`](.github/workflows/test.yml)) runs on every push and PR. Tests must stay green for a merge.

For the full release procedure (signing, `latest.json`, GitHub release, winget bump), see **[docs/RELEASE.md](docs/RELEASE.md)**.

### Project layout

```
src/                       React + TypeScript frontend
  windows/                   SetupWizard · Settings · About · Overlay · UploaderToast
  components/                HotkeyRecorder · RetentionControl · UpdateChecker
  i18n/                      i18next + locales/en.json
  store/                     Zustand global state
  lib/keyMap.ts              KeyboardEvent ↔ Tauri shortcut format

src-tauri/                 Rust backend
  src/commands/              auth · config · drive · screenshot · updater
  src/tray.rs                System tray icon + menu
  src/hotkey.rs              Global shortcut registration
  icons/                     App icons (all sizes, generated by `cargo tauri icon`)
```

## 📄 License

[MIT](LICENSE) © 2025 [Steven Abittan](https://github.com/amys94fr).

Built with [Tauri v2](https://v2.tauri.app/), [React](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/), and [Vitest](https://vitest.dev/).
