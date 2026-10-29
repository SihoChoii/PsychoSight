# PsychoSight on macOS

`PsychoSight.app` is a double-clickable app. It starts the FastAPI backend as a child of the signed `PsychoSight` executable, on `127.0.0.1` only, and opens the UI in a window at that same origin. Port `8765` is used when it is free; otherwise the app picks another free port. Quit the window or the Dock icon and the backend stops with it.

The app bundles its own Python, dependencies, `web/dist`, `schemas/report.schema.json`, and `psychosight` package data (`data/`, `experimental/`, including `wwbp/`). It does not need system Python or Node. A temporary DeepSeek key can be sealed into the app at build time. It is not committed.

## Build and install

On this Mac the build uses Python 3.13 at `/Library/Frameworks/Python.framework/Versions/3.13/bin/python3` and Node from `/opt/homebrew/bin`.

```bash
packaging/macos/build.sh
```

The script writes `dist/PsychoSight.app` in the checkout (gitignored) and copies it to `/Applications/PsychoSight.app`, or `~/Applications/PsychoSight.app` if `/Applications` is not writable. The icon is generated from `web/public/logos/black/psychosigh-symbol.svg`.

The app is not sandboxed. It is signed with the Developer ID Application identity when that identity is available in the keychain, otherwise ad-hoc. Quarantine is cleared on the copy the script installs. The build is not notarized: a copy downloaded from the internet may be blocked until you run `xattr -dr com.apple.quarantine` on it.

## API key

Lookup order, first match wins: `DEEPSEEK_API_KEY`, then a checkout `.env` when you run from source, then `~/.psychosight/.env`, then the bundled `PsychoSight.app/Contents/Resources/psychosight.env`. The packaged app does not read a `.env` packed next to its Python files. `GET /config` reports `llm_key_source` as `env`, `dotenv`, `bundled`, or `null`. The key itself is never returned or logged.

`packaging/macos/build.sh` injects the key after PyInstaller and before signing:

```bash
python scripts/inject_bundled_key.py "dist/PsychoSight.app/Contents/Resources/psychosight.env"
```

The script reads `DEEPSEEK_API_KEY`, otherwise the gitignored repo `.env`, otherwise `~/.psychosight/.env`. It writes mode `600` and prints only a masked key. If none of those has a key, the build still finishes and warns that the app has no bundled key. See `docs/PACKAGING_KEY.md`.

To rotate the key, put the new value in the gitignored `.env` or the environment, rebuild, and re-sign. Anyone who has the `.app` can extract `psychosight.env`, so share the app only with trusted judges and rotate or revoke the key after judging. A user-level `~/.psychosight/.env` or an environment variable overrides the bundled key without rebuilding. Deleting the key in the DeepSeek console is what stops copies that were already shared.

The first launch writes `~/.psychosight/.env.example` if that file is missing, and writes `~/.psychosight/FIRST_RUN.txt` when no key is configured. It does not create or overwrite `~/.psychosight/.env`. Without a key, deterministic reports and the demo (offline mock, labelled "not real model") still work.

Logs are `~/Library/Logs/PsychoSight/server.log` and `launcher.log`. They are not given the API key or message text.

## Full Disk Access

Reading `~/Library/Messages/chat.db` needs Full Disk Access. macOS has no public API that shows a permission prompt for it. On launch, both the signed PsychoSight process and its backend child open `chat.db` read-only and read a few bytes, before the window loads. That is what adds PsychoSight under Privacy & Security → Full Disk Access (the switch stays off until you turn it on). The bytes are discarded. Logs record only `granted`, `reason`, and an error type name — never message text.

The backend is a child of `PsychoSight.app/Contents/MacOS/PsychoSight`, the app's own signed executable, so grant access to **PsychoSight**, not to Terminal or a system Python.

If access is missing, the UI shows the Full Disk Access screen:

1. Choose **Open Full Disk Access Settings**. That runs `open` on `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`.
2. Turn on PsychoSight. If it is not listed, choose **Show in Finder** and drag PsychoSight into the list.
3. Quit PsychoSight and open it again.

**Recheck** probes again without a full restart when this process can already read the file. If a new process can read it and this one cannot, the screen says to quit and reopen — macOS often keeps the denial for the life of the process. The demo conversation works without the grant.

An ad-hoc signature changes every rebuild, so Full Disk Access must be granted again after each ad-hoc rebuild. A Developer ID signature keeps the grant across rebuilds. Re-grant it if macOS shows the app as a new item.
