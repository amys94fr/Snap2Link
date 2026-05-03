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
  `- Download \`Snap2Link_${version}_x64-setup.exe\` and run it. SmartScreen may flag the binary as *"unrecognised app"* (not yet EV-code-signed); click *More info → Run anyway*.`,
  "",
  "**macOS**",
  `- Download \`Snap2Link_${version}_aarch64.dmg\` (Apple Silicon) or \`Snap2Link_${version}_x64.dmg\` (Intel).`,
  '- The app is **not yet notarised**, so the first launch needs a manual override: right-click the app in Finder → *Open* → *Open* in the dialog. Subsequent launches behave normally.',
  '- The first screenshot capture triggers a **Screen Recording permission prompt** in System Preferences → Security & Privacy → Screen Recording. Grant it and re-launch.',
  "",
  "**Linux**",
  `- \`.AppImage\`: \`chmod +x snap2link_${version}_amd64.AppImage && ./snap2link_${version}_amd64.AppImage\` — works on most distros, no install needed.`,
  `- \`.deb\` (Debian/Ubuntu): \`sudo apt install ./snap2link_${version}_amd64.deb\``,
  `- \`.rpm\` (Fedora/RHEL): \`sudo dnf install ./snap2link-${version}-1.x86_64.rpm\``,
  "- The system tray needs `libayatana-appindicator3-1` (preinstalled on most desktop environments).",
  "",
  "After install, complete the OAuth wizard to connect your Google Drive.",
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
