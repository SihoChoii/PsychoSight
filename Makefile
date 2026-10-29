PY ?= .venv/bin/python

venv:
	python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

test:
	$(PY) -m pytest

demo:
	$(PY) -m psychosight analyze --demo --opt-in-llm --out psychosight-report-demo.json

serve:
	$(PY) -m psychosight serve
