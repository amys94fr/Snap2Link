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

## Cutting a release

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
