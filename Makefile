PY ?= .venv/bin/python

venv:
	python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

test:
	$(PY) -m pytest

demo:
	$(PY) -m psychosight analyze --demo --opt-in-llm --out psychosight-report-demo.json

serve:
	$(PY) -m psychosight serve

# Build step for the packaged app: write the git-ignored .env key into the bundle (never into git).
# make bundle-key DEST=dist/PsychoSight.app/Contents/Resources/psychosight.env
bundle-key:
	@test -n "$(DEST)" || (echo "usage: make bundle-key DEST=path/to/PsychoSight.app/Contents/Resources/psychosight.env" >&2; exit 2)
	$(PY) scripts/inject_bundled_key.py "$(DEST)"
