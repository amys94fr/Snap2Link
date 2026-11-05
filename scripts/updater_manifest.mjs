// Builds the `platforms` object of latest.json from the workflow artefacts,
// and refuses any signature the updater would reject.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO_BASE = "https://github.com/amys94fr/Snap2Link/releases/download";

// Each entry maps an installer to its updater platform keys. A
// `darwin-universal` build serves both ARM and Intel Macs (Tauri lipos a single
// .app.tar.gz containing both architectures), so it expands into both keys.
//
// The updater looks for `{os}-{arch}-{bundle type}`, then `{os}-{arch}`, and
// installs what it downloads the way the running app was installed. So
// `linux-x86_64` can only serve the AppImage: without their own keys, .deb and
// .rpm installs would fall back to it and fail with "invalid updater binary
// format".
export const PLATFORMS = [
  {
    keys: ["windows-x86_64"],
    artefactDir: "bundle-windows-x86_64",
    installerPattern: /-setup\.exe$/i,
  },
  {
    keys: ["darwin-aarch64", "darwin-x86_64"],
    artefactDir: "bundle-darwin-universal",
    installerPattern: /\.app\.tar\.gz$/i,
  },
  {
    keys: ["linux-x86_64"],
    artefactDir: "bundle-linux-x86_64",
    installerPattern: /\.AppImage$/i,
  },
  {
    keys: ["linux-x86_64-deb"],
    artefactDir: "bundle-linux-x86_64",
    installerPattern: /\.deb$/i,
  },
  {
    keys: ["linux-x86_64-rpm"],
    artefactDir: "bundle-linux-x86_64",
    installerPattern: /\.rpm$/i,
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

// The second line of a Tauri key or signature, once decoded, is the base64
// minisign payload: a 2-byte algorithm, an 8-byte key id, then the key or
// signature itself.
function minisignPayload(encoded) {
  const line = Buffer.from(encoded, "base64").toString("utf8").split(/\r?\n/)[1];
  return Buffer.from(line, "base64").subarray(10);
}

// Tauri signs a BLAKE2b hash of the file, not the file itself.
export function signatureMatches(fileBytes, signature, pubkey) {
  const publicKey = crypto.createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: minisignPayload(pubkey).toString("base64url"),
    },
    format: "jwk",
  });
  const hash = crypto.createHash("blake2b512").update(fileBytes).digest();
  return crypto.verify(null, hash, publicKey, minisignPayload(signature));
}

export function collectPlatforms({ artefactsRoot, version, pubkey, allowMissing = false }) {
  const platforms = {};
  const summary = [];

  for (const p of PLATFORMS) {
    const label = p.keys.join("+");
    const installerFile = findFile(path.join(artefactsRoot, p.artefactDir), p.installerPattern);
    const sigFile = `${installerFile}.sig`;
    if (!installerFile || !fs.existsSync(sigFile)) {
      // A platform left out of the manifest gets no update and no warning.
      if (!allowMissing) {
        throw new Error(`${label}: no ${p.installerPattern} with its .sig in ${p.artefactDir}`);
      }
      summary.push(`  ${label}: skipped`);
      continue;
    }

    const signature = fs.readFileSync(sigFile, "utf8").trim();
    const installerName = path.basename(installerFile);
    if (!signatureMatches(fs.readFileSync(installerFile), signature, pubkey)) {
      throw new Error(`${label}: ${installerName} doesn't match its signature`);
    }

    const url = `${REPO_BASE}/v${version}/${installerName}`;
    for (const key of p.keys) {
      platforms[key] = { signature, url };
    }
    summary.push(`  ${label}: ${installerName} (sig ${signature.length} chars)`);
  }

  return { platforms, summary };
}
