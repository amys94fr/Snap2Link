# Releasing Snap2Link

Snap2Link uses [tauri-plugin-updater](https://v2.tauri.app/plugin/updater/)
to ship in-app updates. The updater checks a JSON manifest on every
"Check for Updates" click; when a newer version is published, the user
gets a download/install button right inside Settings.

## How the pieces fit together

| Piece | Where it lives |
|---|---|
| Public key (committed) | `tauri.conf.json` → `plugins.updater.pubkey` |
| Public key (committed copy) | `.tauri-keys/snap2link.key.pub` |
| Private key (gitignored) | `.tauri-keys/snap2link.key` |
| Update endpoint | `tauri.conf.json` → `plugins.updater.endpoints` |
| Manifest format | `latest.json` published next to the installer |

## One-time setup (already done)

The signing keypair was generated with:

```bash
cargo tauri signer generate -w .tauri-keys/snap2link.key -p ""
```

The private key (`.tauri-keys/snap2link.key`) is gitignored. **Back it up
somewhere safe** — losing it means existing installs will reject any
update you try to ship.

## Cutting a release — automated path (recommended)

The repo ships a GitHub Actions workflow (`.github/workflows/release.yml`)
that does the *entire* release flow for you. After the one-time secret
setup below, every release is just:

```bash
# 1. Bump version in package.json + src-tauri/Cargo.toml + src-tauri/tauri.conf.json
# 2. Add a [X.Y.Z] section to CHANGELOG.md
git add -A && git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

The workflow then:

1. Runs frontend + backend tests (release fails if anything is red).
2. Restores `credentials.json` from a secret.
3. Builds a signed Tauri bundle (Windows NSIS).
4. Generates `latest.json` from the freshly-signed `.exe`.
5. Generates a release body from the matching `CHANGELOG.md` section.
6. Creates the GitHub release with installer + `.sig` + `latest.json`.
7. (Optional) submits a `wingetcreate update` PR to `microsoft/winget-pkgs`.

### One-time secret setup

Configure these at <https://github.com/amys94fr/Snap2Link/settings/secrets/actions>:

| Secret | Value | Required |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The full text content of `.tauri-keys/snap2link.key` | ✅ |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Empty string (the current key has no password). Falls back to `""` if absent. | optional |
| `GOOGLE_CREDENTIALS_JSON` | The full text content of your `credentials.json` (Google OAuth desktop client) | ✅ |
| `WINGET_PAT` | A GitHub fine-grained PAT with `public_repo` scope (used to fork `microsoft/winget-pkgs`) | optional |

And one repo variable at <https://github.com/amys94fr/Snap2Link/settings/variables/actions>:

| Variable | Value | Required |
|---|---|---|
| `SUBMIT_WINGET` | `true` to auto-submit a winget update PR after every release. | optional |

### Failure modes

- The `submit-winget` job will fail (and the rest of the release will succeed)
  on the very first run because `wingetcreate update` requires the package to
  already exist in `microsoft/winget-pkgs`. Once the initial v1.0.0 PR is merged,
  this stops being an issue.
- If you regenerate the signing keypair you must update both
  `tauri.conf.json` (`plugins.updater.pubkey`) **and** the
  `TAURI_SIGNING_PRIVATE_KEY` secret. Existing installs reject the new key
  silently otherwise.

---

## Cutting a release — manual path

1. Bump `version` in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Update `CHANGELOG.md`.
3. Build a signed bundle:

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content .\.tauri-keys\snap2link.key -Raw)
   # The current key was generated without a password — Tauri *still*
   # expects the env var to be set (to an empty string) to avoid an
   # interactive prompt during bundling:
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   # If you regenerate the key with a password, set the value here instead.

   npm run tauri build
   ```

   Tauri will produce these files in `src-tauri/target/release/bundle/`:
   - `nsis/Snap2Link_<version>_x64-setup.exe`
   - `nsis/Snap2Link_<version>_x64-setup.exe.sig` (signature, ~420 chars base64)
   - `msi/Snap2Link_<version>_x64_en-US.msi(.sig)` (alternate installer)

4. Generate the manifest from the freshly built bundle:

   ```powershell
   .\scripts\make_latest_json.ps1 -Version 1.1.0 -Notes "Short summary"
   # Output: scripts\release-out\latest.json
   ```

5. Create the GitHub release with `gh`:

   ```powershell
   gh release create v1.1.0 `
     --title "Snap2Link v1.1.0" `
     --notes-file scripts/release-out/release-body.md `
     src-tauri/target/release/bundle/nsis/Snap2Link_1.1.0_x64-setup.exe `
     src-tauri/target/release/bundle/nsis/Snap2Link_1.1.0_x64-setup.exe.sig `
     scripts/release-out/latest.json
   ```

6. The endpoint in `tauri.conf.json` already points at
   `https://github.com/amys94fr/Snap2Link/releases/latest/download/latest.json`,
   so as soon as the release is marked "Latest" on GitHub, every running
   client will pick up the update on the next "Check for Updates" click.

## Testing the updater locally before shipping

If you want to verify the flow without publishing publicly:

1. Start a local file server in a folder that contains `latest.json` and
   the installer/.sig (e.g. `npx serve -p 8080 ./test-release`).
2. Temporarily change `tauri.conf.json` → `plugins.updater.endpoints` to
   `["http://localhost:8080/latest.json"]`.
3. Bump the local app's version number to be lower than the manifest's,
   rebuild with `npm run tauri build`, run the produced exe, and click
   "Check for Updates".
