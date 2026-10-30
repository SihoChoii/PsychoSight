# Bundling the DeepSeek key into the packaged macOS app

Siho's decision: the **temporary** DeepSeek key ships **inside the packaged `PsychoSight.app` only**. It is never
committed to git. Siho will delete (revoke) this key after judging, so exposure inside the app bundle is accepted.

## Build step (packager)

After the app is built (PyInstaller / py2app / bundled venv), and before signing/zipping, run from the repo root:

```bash
python scripts/inject_bundled_key.py "dist/PsychoSight.app/Contents/Resources/psychosight.env"
# or
make bundle-key DEST=dist/PsychoSight.app/Contents/Resources/psychosight.env
```

- The key is read from the `DEEPSEEK_API_KEY` environment variable, else from the git-ignored repo-root `.env`
  (`--env-file PATH` reads another file). `DEEPSEEK_MODEL`, `DEEPSEEK_REASONING_EFFORT`, `DEEPSEEK_BASE_URL` and
  `DEEPSEEK_THINKING` are copied too when set (the env var wins over the file, per setting).
- The destination is written atomically with mode `600`; parent directories are created.
- Output names only the destination and a masked key (`sk-…1234`). The key is never printed.
- Exit `1` with a clear message when no key is found; exit `2` (refuses) when the destination is inside this git
  checkout and not git-ignored (`--allow-tracked` overrides; don't).
- Sign the app **after** injecting (the file is part of the bundle's sealed resources).

Alternative location when the Python package itself is copied into the bundle: `psychosight/_bundled/psychosight.env`
inside the bundled package (git-ignored in the repo).

## Lookup order at runtime

Each setting (key, model, effort, ...) is resolved independently, first match wins:

1. Environment variable (`DEEPSEEK_API_KEY`, ...) → `llm_key_source: "env"`
2. `.env` at the repo root (next to the `psychosight` package) → `"dotenv"`
3. `~/.psychosight/.env` → `"dotenv"`
   (2 and 3 are replaced by `PSYCHOSIGHT_DOTENV`, an os.pathsep-separated list, when set)
4. **Bundled file** (lowest priority) → `"bundled"`, the first readable of:
   1. `$PSYCHOSIGHT_BUNDLED_ENV`: an explicit path. When set it is the **only** bundled candidate.
   2. `<package dir>/_bundled/psychosight.env` (the `psychosight` package directory inside the bundle)
   3. `<App>.app/Contents/Resources/psychosight.env`, found by walking up from `sys.executable`, `sys.argv[0]` or the
      package file to the first `*.app` ancestor that has a `Contents/` directory.

The file format is the same `KEY=VALUE` `.env` format (`#` comments, optional `export`, optional quotes).
If no model is set anywhere the default `deepseek-flash` is used, at reasoning level `low` unless
`DEEPSEEK_REASONING_EFFORT` (`none` | `low` | `high` | `max`) is set; each analysis can still choose its own level.
`GET /config` reports `llm_available`, `llm_key_source` (`env` | `dotenv` | `bundled` | `null`) and `llm_key_note`
(`null` when a key is found, else the message listing the places searched). The key is never returned.

## Masking

The key never appears in logs, error bodies, job errors, report JSON / `run_meta`, `/config` or CLI output:
error messages and log lines are scrubbed of any loaded key and any `sk-...` token (shown as `sk-…1234` in errors,
`[redacted]` in logs). `check-llm` prints only the masked key and its source.

## Rotate or delete the key

- **Rotate**: put the new key in the git-ignored `.env` (or export it), rerun the build step, re-sign, re-zip.
  For an installed app you can also overwrite `PsychoSight.app/Contents/Resources/psychosight.env` in place
  (this breaks the code signature; re-sign) and restart the app. A user-level `~/.psychosight/.env` or an env var
  always overrides the bundled key without touching the app.
- **Delete**: revoke the key in the DeepSeek console (this is the real kill switch for copies already shared),
  then `rm PsychoSight.app/Contents/Resources/psychosight.env` (and `psychosight/_bundled/` if used). Without a key,
  the demo falls back to the offline mock (`demo_provider_note` explains why) and real conversations get
  deterministic-only reports; opting in returns `LLM_UNAVAILABLE` with the list of places searched.

## Guardrails

- `.gitignore` covers `.env`, `.env.*` (except `.env.example`), `psychosight/_bundled/`, `**/psychosight.env`,
  `*.app/`, `dist/` and `build/`.
- `tests/test_no_secrets.py` fails if any tracked file contains a key-shaped string (`sk-` + 20 or more letters/digits)
  or a `DEEPSEEK_API_KEY=` with a non-placeholder value (fixtures marked `FAKE` and `your-key-here` are allowed), and
  asserts the bundled paths are git-ignored.
