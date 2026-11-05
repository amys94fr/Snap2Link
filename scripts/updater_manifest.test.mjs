// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectPlatforms, signatureMatches } from "./updater_manifest.mjs";

// Made with `tauri signer` and a throwaway key, so these tests read the real
// format rather than one they built themselves.
const PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDEwMzY3QTcwQ0QzNERERkUKUldUKzNUVE5jSG8yRUQ0T0kxUU5sNUt3ckdaOFdBbWw2OE9yMG4wTHI5YVgxNWptTmNKYytTVDgK";
const CONTENT = "snap2link updater fixture\n";
const SIGNATURE =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUKzNUVE5jSG8yRUtBWDMxbmRwMGxuWWt3ek9uTWFxYXpHS3JMTkphRmc0Z0JYRFI1NHNBU3VqWG5QWWl3S2hNYmdMdlFzRk1oY1VGaFhlcWJkVFhaWWdpcXVsWmJCVHc4PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzODc3NjIxCWZpbGU6Zml4dHVyZS5iaW4JdmVyc2lvbjo5LjkuOQorUWY5NWMveXl6MzFhOFBYaEVJUHBRdGczS25pZ05nbzR6NXhJSkk1bGdBZU96NzE5cWEydXg2RC9ScHlLVTg3VlNweEdSSGdobm03akRIK2tsdzNBUT09Cg==";

const LINUX = "bundle-linux-x86_64/x86_64-unknown-linux-gnu/release/bundle";
const APPIMAGE = `${LINUX}/appimage/Snap2Link_2.0.0_amd64.AppImage`;
const DEB = `${LINUX}/deb/Snap2Link_2.0.0_amd64.deb`;
const RPM = `${LINUX}/rpm/Snap2Link-2.0.0-1.x86_64.rpm`;
const INSTALLERS = [
  "bundle-windows-x86_64/x86_64-pc-windows-msvc/release/bundle/nsis/Snap2Link_2.0.0_x64-setup.exe",
  "bundle-darwin-universal/macos/Snap2Link.app.tar.gz",
  APPIMAGE,
  DEB,
  RPM,
];

describe("collectPlatforms", () => {
  let root;

  const write = (relative, contents) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  const collect = (options) =>
    collectPlatforms({ artefactsRoot: root, version: "2.0.0", pubkey: PUBKEY, ...options });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "snap2link-artefacts-"));
    for (const installer of INSTALLERS) {
      write(installer, CONTENT);
      write(`${installer}.sig`, SIGNATURE);
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("gives every install type the package it can install", () => {
    const { platforms } = collect();
    const base = "https://github.com/amys94fr/Snap2Link/releases/download/v2.0.0";

    expect(Object.keys(platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-x86_64",
    ]);
    expect(platforms["linux-x86_64"].url).toBe(`${base}/Snap2Link_2.0.0_amd64.AppImage`);
    expect(platforms["linux-x86_64-deb"].url).toBe(`${base}/Snap2Link_2.0.0_amd64.deb`);
    expect(platforms["linux-x86_64-rpm"].url).toBe(`${base}/Snap2Link-2.0.0-1.x86_64.rpm`);
    expect(platforms["linux-x86_64"].signature).toBe(SIGNATURE);
  });

  it("refuses an installer changed after it was signed", () => {
    write(APPIMAGE, `${CONTENT}repacked`);

    expect(() => collect()).toThrow(/Snap2Link_2\.0\.0_amd64\.AppImage doesn't match/);
  });

  it("refuses a missing signature", () => {
    fs.rmSync(path.join(root, `${APPIMAGE}.sig`));

    expect(() => collect()).toThrow(/^linux-x86_64: /);
  });

  it("refuses a missing platform unless asked to skip it", () => {
    fs.rmSync(path.join(root, "bundle-darwin-universal"), { recursive: true });

    expect(() => collect()).toThrow(/^darwin-aarch64\+darwin-x86_64: /);

    const { platforms, summary } = collect({ allowMissing: true });
    expect(platforms).not.toHaveProperty("darwin-aarch64");
    expect(platforms).toHaveProperty("linux-x86_64");
    expect(summary).toContain("  darwin-aarch64+darwin-x86_64: skipped");
  });
});

describe("signatureMatches", () => {
  it("accepts the signed bytes and nothing else", () => {
    expect(signatureMatches(Buffer.from(CONTENT), SIGNATURE, PUBKEY)).toBe(true);
    expect(signatureMatches(Buffer.from(`${CONTENT}!`), SIGNATURE, PUBKEY)).toBe(false);
  });
});
