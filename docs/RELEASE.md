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
   # If you set a password on the key, also:
   # $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-password"

   npm run tauri build
   ```

   Tauri will produce two files in `src-tauri/target/release/bundle/`:
   - `nsis/Snap2Link_<version>_x64-setup.exe`
   - `nsis/Snap2Link_<version>_x64-setup.exe.sig` (signature, ~hex blob)

4. Create a GitHub release tagged `v<version>` and upload **both** files
   plus a `latest.json` manifest that looks like:

   ```json
   {
     "version": "1.1.0",
     "notes": "Short release notes — shown in the Settings updater UI.",
     "pub_date": "2026-05-03T08:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<contents of the .sig file, no newlines>",
         "url": "https://github.com/amys94fr/snap2link/releases/download/v1.1.0/Snap2Link_1.1.0_x64-setup.exe"
       }
     }
   }
   ```

5. The endpoint in `tauri.conf.json` already points at
   `https://github.com/amys94fr/snap2link/releases/latest/download/latest.json`,
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
