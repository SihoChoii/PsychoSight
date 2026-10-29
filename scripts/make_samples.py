"""Regenerate docs/sample_report*.json from the synthetic demo conversation (fictional data only).

  .venv/bin/python scripts/make_samples.py                       # both samples, offline mock LLM for the full one
  .venv/bin/python scripts/make_samples.py --full-from REPORT    # full sample = a saved real-model demo report
                                                                 # (GET /analyses/{id}/report output), re-labelled
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["PSYCHOSIGHT_DATA_DIR"] = tempfile.mkdtemp(prefix="ps-samples-")
os.environ["PSYCHOSIGHT_DEMO_PROVIDER"] = "mock"  # never call the API from this script

from psychosight import pipeline, report  # noqa: E402


def write(name: str, rep: dict) -> None:
    report.validate(rep)
    (ROOT / "docs" / name).write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", name, rep["mode"], rep["run_meta"]["provider"])


args = sys.argv[1:]
if "--full-from" in args:
    rep = json.loads(Path(args[args.index("--full-from") + 1]).read_text(encoding="utf-8"))
    assert rep["header"]["is_demo"] and rep["run_meta"]["source"] == "demo", "only the synthetic demo may be a sample"
    rep["report_id"] = rep["run_meta"]["run_id"] = "sample-full"
    write("sample_report.json", rep)
else:
    write("sample_report.json", pipeline.run_analysis("demo", llm_opt_in=True, report_id="sample-full", save=False))
write("sample_report_deterministic_only.json",
      pipeline.run_analysis("demo", llm_opt_in=False, report_id="sample-deterministic", save=False))
