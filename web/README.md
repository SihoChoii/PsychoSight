# Web UI

PsychoSight Lite’s local interface. Vite + React + TypeScript. The FastAPI process serves the production build from `web/dist` (see `docs/API.md`).

Colors, type, and spacing come from `src/brand/tokens.css`, copied verbatim from the PsychoSigh brand kit. Fonts live beside that file. Theme logos, the symbol, and favicons are in `public/logos/black` and `public/logos/white` and switch with `data-theme`.

## Commands

```bash
cd web
npm install
npm test
npm run dev       # http://127.0.0.1:5173
npm run build     # web/dist
npm run preview   # serves the build on http://127.0.0.1:4173
```

From the repo root, after `npm run build`:

```bash
.venv/bin/python -m psychosight serve
# http://127.0.0.1:8765
```

## API base

Requests are same-origin (`/config`, `/conversations`, `/analyses`). The dev server proxies those paths to `http://127.0.0.1:8765`. Set `VITE_API_BASE` only when the API is on another origin, for example `VITE_API_BASE=http://127.0.0.1:8766`.

## Mock mode

Works with no backend, no chat.db, and no API key. Reports are the checked-in sample JSON files. Conversations are labeled demo data.

```bash
npm run dev
# http://127.0.0.1:5173/?mock=1
VITE_MOCK=1 npm run dev
```

`?mock=0` forces the real API even when `VITE_MOCK=1`.

Useful mock URLs:

- `?mock=1&disk=1` — Full Disk Access help, with “Try demo conversation”
- `?mock=1&freeze=scoring#/run/preview` — progress held at 12 of 40 episodes
- `?mock=1&freeze=experimental#/run/preview` — experimental stage held at 4 of 8 finished
- `?mock=1#/report/sample-full` — full sample report, schema 1.0.0, no experimental section
- `?mock=1#/report/sample-det` — deterministic-only sample (`not_run` sections, no experimental section)
- `?mock=1#/report/sample-exp` — stub experimental section from `docs/sample_experimental_scores.json`
- `?mock=1#/report/sample-exp-real` — 12 dimensions, both speakers, no insufficient data
- `?mock=1#/report/sample-exp-det` — deterministic markers only
- `?mock=1#/report/sample-exp-me` — other person not scored (`per_speaker.other` is null)
- `?mock=1#/report/sample-exp-failed` — section status `failed`
- `?mock=1#/report/sample-exp-notrun` — section status `not_run`
- `?mock=1#/report/sample-exp-thin` — section status `insufficient_data`
- `?theme=white` or `?theme=black`

The disclosure on the opt-in screen is the string from `GET /config` (`opt_in_text`). Mock mode reads `src/fixtures/mock-config.json`, which is a snapshot of that field and must stay identical to `psychosight/config.py`.
