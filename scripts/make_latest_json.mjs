#!/usr/bin/env node
// Generates latest.json for the Tauri updater from a folder of downloaded
// workflow artefacts produced by release.yml's matrix build.
//
// Expected layout (relative to repo root):
//   artefacts/
//     bundle-windows-x86_64/.../Snap2Link_<v>_x64-setup.exe + .sig
//     bundle-darwin-universal/.../Snap2Link.app.tar.gz      + .sig
//     bundle-linux-x86_64/.../Snap2Link_<v>_amd64.AppImage  + .sig
//     bundle-linux-x86_64/.../Snap2Link_<v>_amd64.deb       + .sig
//     bundle-linux-x86_64/.../Snap2Link-<v>-1.x86_64.rpm    + .sig
//
// Usage:
//   node scripts/make_latest_json.mjs \
//     --version 1.1.0 \
//     --notes "Initial multi-platform release."
//
// Fails if a signature doesn't match its installer, or if a platform is
// missing, unless --allow-missing is passed.
//
// Output: scripts/release-out/latest.json (committed by softprops/action-gh-release).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectPlatforms } from "./updater_manifest.mjs";

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

const tauriConf = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"),
);

const { platforms, summary } = collectPlatforms({
  artefactsRoot,
  version,
  pubkey: tauriConf.plugins.updater.pubkey,
  allowMissing: process.argv.includes("--allow-missing"),
});

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
