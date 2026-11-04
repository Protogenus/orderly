# Orderly — Build & Install Instructions (v0.1.0)

## For the user (Windows)

1. Extract `orderly-0.1.0.zip` to any folder (keep the folder structure).
2. Double-click `START_ORDERLY.bat`.
3. That's it — no installer, no account, no internet needed.

Data lives in `%APPDATA%\Orderly\`. Back up from Settings > Backup.

## For the developer

Prerequisites: Node.js 22+, npm. (Windows packaging is done on Linux via electron-builder.)

```bash
cd ~/workspace/orderly
npm install
npm run rebuild        # build better-sqlite3 for the local Electron (dev/test only)
npm run typecheck      # tsc, node + web configs
npm test               # vitest unit suite
npm run build          # electron-vite -> out/
export TMPDIR=~/.orderly-test-tmp   # /tmp is a 512MB tmpfs shared with sibling builds
xvfb-run -a npx playwright test     # E2E against the built app
npm run dist           # electron-builder --win --x64 -> release/
```

Tests use `ORDERLY_DATA_DIR` to isolate databases per test; temp dirs are wiped afterwards.
Never commit with failing tests. No seed/demo data exists in the repo — verification databases are
created and destroyed by the tests themselves.

## Release assembly

1. `npm run dist` → `release/Orderly-0.1.0-win.zip` (electron-builder, nsis + zip targets).
2. Extract the electron-builder zip's `win-unpacked/` into `release-staging/`.
3. `release-staging/` already contains `START_ORDERLY.bat` (CRLF, pauses on error) and `README.txt`.
4. Zip the staging contents as `~/workspace/orderly-0.1.0.zip`.
5. Verify from a FRESH extract: unzip to a new folder, confirm `win-unpacked/Orderly.exe` exists,
   `resources/app.asar` + `app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node`
   are present, and the layout matches what the bat expects.

## Native module note (better-sqlite3)

better-sqlite3 ships npm prebuilds per platform, and at runtime it prefers
`prebuilds/<platform>-<arch>.node`. The prebuild that loads under Electron on Linux is the same ABI
family as `prebuilds/win32-x64.node` under Electron on Windows, so the Windows package uses the npm
prebuild directly: the build sets `npmRebuild: false` because node-gyp cannot cross-compile, and
`asarUnpack: ["**/*.node"]` so the native binding stays loadable outside the asar archive.
