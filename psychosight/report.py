"""Assemble and validate the report JSON (schemas/report.schema.json)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import List, Optional

import jsonschema

from . import config
from .errors import ReportInvalid


@lru_cache(maxsize=1)
def _validator() -> jsonschema.Draft202012Validator:
    schema = json.loads(config.SCHEMA_PATH.read_text())
    return jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())


def validation_errors(report: dict) -> List[str]:
    return [f"{'/'.join(str(p) for p in e.absolute_path)}: {e.validator}" for e in _validator().iter_errors(report)]


def validate(report: dict) -> dict:
    errors = validation_errors(report)
    if errors:
        raise ReportInvalid(f"Report failed schema validation: {errors[:5]}")
    return report


def not_run_section(reason: str = config.NOT_RUN_REASON) -> dict:
    return {"status": "not_run", "reason": reason}


def rubric_section(status: str, reason: Optional[str], items: List[dict], unstable: List[str], selected: int,
                   scored: int, agreement: Optional[float], prompt_version: Optional[str]) -> dict:
    return {"status": status, "reason": reason, "scored_speaker": "me", "prompt_version": prompt_version,
            "episodes_selected": selected, "episodes_scored": scored, "agreement_rate": agreement,
            "unstable_items": unstable, "items": [{k: v for k, v in i.items() if not k.startswith("_")} for i in items]}


def observations_section(status: str, reason: Optional[str], items: List[dict], prompt_version: Optional[str],
                         note: Optional[str] = None) -> dict:
    return {"status": status, "reason": reason, "prompt_version": prompt_version, "note": note, "items": items}


def assemble(*, report_id: str, mode: str, header: dict, weeks: List[dict], series: List[dict], episodes: List[dict],
             rubric: dict, observations: dict, quotes: List[dict], run_meta: dict) -> dict:
    report = {
        "schema_version": config.SCHEMA_VERSION, "report_id": report_id, "mode": mode, "header": header,
        "weeks": weeks, "series": series, "episodes": episodes, "rubric": rubric, "observations": observations,
        "quotes": quotes, "limitations_title": config.LIMITATIONS_TITLE, "limitations": list(config.LIMITATIONS),
        "disclaimer": config.DISCLAIMER, "run_meta": run_meta,
    }
    return validate(report)
