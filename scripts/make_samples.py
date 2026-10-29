"""Regenerate docs/sample_report*.json from the demo pipeline (mock LLM, synthetic data only)."""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["PSYCHOSIGHT_DATA_DIR"] = tempfile.mkdtemp(prefix="ps-samples-")
os.environ.pop("PSYCHOSIGHT_DEMO_PROVIDER", None)

from psychosight import pipeline  # noqa: E402

for name, opt_in, rid in (("sample_report.json", True, "sample-full"),
                          ("sample_report_deterministic_only.json", False, "sample-deterministic")):
    rep = pipeline.run_analysis("demo", llm_opt_in=opt_in, report_id=rid, save=False)
    (ROOT / "docs" / name).write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", name, rep["mode"])
