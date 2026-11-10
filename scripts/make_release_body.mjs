#!/usr/bin/env node
// Extracts the matching version section out of CHANGELOG.md and tacks on
// per-platform install instructions for the GitHub release body.
//
// Usage:
//   node scripts/make_release_body.mjs --tag v1.1.0 --repo amys94fr/Snap2Link

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const tag = arg("tag");
const repo = arg("repo") ?? "amys94fr/Snap2Link";
if (!tag) throw new Error("Missing --tag");
const version = tag.replace(/^v/, "");

let section = `See [CHANGELOG.md](https://github.com/${repo}/blob/main/CHANGELOG.md) for details.`;
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
if (fs.existsSync(changelogPath)) {
  const md = fs.readFileSync(changelogPath, "utf8");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^## \\[${escaped}\\][^\\r\\n]*[\\r\\n]+([\\s\\S]*?)(?=^## \\[|\\z)`, "m");
  const m = md.match(re);
  if (m) section = m[1].trim();
}

const lines = [
  `## Snap2Link ${tag}`,
  "",
  section,
  "",
  "---",
  "",
  "### Installation",
  "",
  "**Windows**",
  process.env.WINDOWS_SIGNED === "true"
    ? `- Download \`Snap2Link_${version}_x64-setup.exe\` and run it. The installer is signed: free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). See the [code signing policy](https://snap2link.app/code-signing/).`
    : `- Download \`Snap2Link_${version}_x64-setup.exe\` and run it. SmartScreen may flag it as an *"unrecognised app"* because it isn't code-signed yet; click *More info → Run anyway*. See the [code signing policy](https://snap2link.app/code-signing/).`,
  "",
  "**macOS**",
  `- Download \`Snap2Link_${version}_universal.dmg\` — a single Universal binary that runs natively on both Apple Silicon and Intel Macs.`,
  '- The app is **not yet notarised**, so macOS blocks the first launch. Open it once and close the warning, then go to *System Settings → Privacy & Security*, scroll to *Security* and click **Open Anyway** next to Snap2Link. On macOS 14 and earlier, Control-click the app in Finder and choose *Open* instead. Later launches behave normally.',
  '- The first capture asks for **Screen Recording permission** in *System Settings → Privacy & Security → Screen & System Audio Recording* (*Screen Recording* on macOS 13 and 14). Turn on Snap2Link and re-launch it.',
  "",
  "**Linux**",
  `- \`.AppImage\`: \`chmod +x snap2link_${version}_amd64.AppImage && ./snap2link_${version}_amd64.AppImage\` — works on most distros, no install needed.`,
  `- \`.deb\` (Debian/Ubuntu): \`sudo apt install ./snap2link_${version}_amd64.deb\``,
  `- \`.rpm\` (Fedora/RHEL): \`sudo dnf install ./snap2link-${version}-1.x86_64.rpm\``,
  "- The system tray needs `libayatana-appindicator3-1` (preinstalled on most desktop environments).",
  "",
  "After install, the setup wizard lets you choose where captures go: Snap2Link hosting, with no account needed, or your own Google Drive.",
  "",
  "### Files in this release",
  "",
  "Each platform ships an installer plus a signed updater archive (`.sig`) consumed by the in-app *Check for Updates* feature. You can ignore the `.sig` and `.tar.gz` files unless you're testing the updater manually.",
];

const outDir = path.join(repoRoot, "scripts", "release-out");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "release-body.md");
fs.writeFileSync(outFile, lines.join("\n"), "utf8");

console.log(`Wrote ${outFile} (${fs.statSync(outFile).size} bytes)`);
