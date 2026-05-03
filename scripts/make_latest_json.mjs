#!/usr/bin/env node
// Generates latest.json for the Tauri updater from a folder of downloaded
// workflow artefacts produced by release.yml's matrix build.
//
// Expected layout (relative to repo root):
//   artefacts/
//     bundle-windows-x86_64/Snap2Link_<v>_x64-setup.exe       + .sig
//     bundle-darwin-aarch64/Snap2Link.app.tar.gz              + .sig
//     bundle-darwin-x86_64/Snap2Link.app.tar.gz               + .sig
//     bundle-linux-x86_64/snap2link_<v>_amd64.AppImage.tar.gz + .sig
//
// Usage:
//   node scripts/make_latest_json.mjs \
//     --version 1.1.0 \
//     --notes "Initial multi-platform release."
//
// Output: scripts/release-out/latest.json (committed by softprops/action-gh-release).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const version = arg("version");
if (!version) throw new Error("Missing --version");
const notes = arg("notes") ?? `See the release description for details.`;

const artefactsRoot = path.join(repoRoot, "artefacts");
if (!fs.existsSync(artefactsRoot)) {
  throw new Error(`Artefacts folder not found: ${artefactsRoot}`);
}

const REPO_BASE = "https://github.com/amys94fr/Snap2Link/releases/download";

// Map platform → { signature pattern, installer pattern }.
// `find` returns the *first* file matching the pattern; missing platforms
// are simply omitted from the manifest (so Mac users won't be offered a
// Windows update etc.).
const PLATFORMS = [
  {
    key: "windows-x86_64",
    artefactDir: "bundle-windows-x86_64",
    sigPattern: /\.exe\.sig$/i,
    installerPattern: /-setup\.exe$/i,
  },
  {
    key: "darwin-aarch64",
    artefactDir: "bundle-darwin-aarch64",
    sigPattern: /\.app\.tar\.gz\.sig$/i,
    installerPattern: /\.app\.tar\.gz$/i,
  },
  {
    key: "darwin-x86_64",
    artefactDir: "bundle-darwin-x86_64",
    sigPattern: /\.app\.tar\.gz\.sig$/i,
    installerPattern: /\.app\.tar\.gz$/i,
  },
  {
    key: "linux-x86_64",
    artefactDir: "bundle-linux-x86_64",
    sigPattern: /\.AppImage\.tar\.gz\.sig$/i,
    installerPattern: /\.AppImage\.tar\.gz$/i,
  },
];

function findFile(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, pattern);
      if (nested) return nested;
    } else if (pattern.test(entry.name)) {
      return full;
    }
  }
  return null;
}

const platforms = {};
const summary = [];

for (const p of PLATFORMS) {
  const dir = path.join(artefactsRoot, p.artefactDir);
  const sigFile = findFile(dir, p.sigPattern);
  const installerFile = findFile(dir, p.installerPattern);
  if (!sigFile || !installerFile) {
    summary.push(`  ${p.key}: skipped (sig=${!!sigFile}, installer=${!!installerFile})`);
    continue;
  }
  const signature = fs.readFileSync(sigFile, "utf8").trim();
  const installerName = path.basename(installerFile);
  platforms[p.key] = {
    signature,
    url: `${REPO_BASE}/v${version}/${installerName}`,
  };
  summary.push(`  ${p.key}: ${installerName} (sig ${signature.length} chars)`);
}

if (Object.keys(platforms).length === 0) {
  throw new Error("No platform artefacts were found. Did the build matrix complete?");
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms,
};

const outDir = path.join(repoRoot, "scripts", "release-out");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "latest.json");
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Wrote ${outFile}`);
console.log(`Platforms in manifest:`);
console.log(summary.join("\n"));
