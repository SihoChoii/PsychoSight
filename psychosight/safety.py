"""Banned-terms lint for prompts, schema descriptions, report copy and observation text.

The fixed disclaimer and the limitations text are allow-listed: they must mention words like
"diagnosis" in negation. Code identifiers (e.g. message `attachments` in msgexport) are out of scope;
only human-readable copy is linted.
"""

from __future__ import annotations

import re
from typing import Iterable, List

from . import config

BANNED = [
    r"diagnos", r"disorder", r"clinical", r"\bt-?scores?\b", r"relapse", r"suicid", r"self-harm",
    r"narcissis", r"impulsiv", r"\battachment\b", r"anxious attachment", r"\bavoidant\b", r"borderline",
    r"bipolar", r"depress", r"psychopath", r"sociopath", r"personality trait", r"neuroticism", r"\bneo\b",
    r"\bneo-pi", r"pid-5", r"hitop", r"biaffect", r"entropy", r"kalman", r"1\.40", r"patholog", r"symptom",
    r"mental illness", r"\btoxic\b", r"gaslight", r"manipulat", r"elevation", r"\bcut-?offs?\b", r"\bpatient\b",
]
# Generalization / trait / causal / norm wording, flagged in prompts and observations.
GENERALIZATION = [r"\balways\b", r"\bnever\b", r"is the type of person", r"tends to be"]
OBSERVATION_ONLY = [
    r"\btends? to\b", r"type of person", r"kind of person", r"\bpersonality\b", r"\byou are an?\b",
    r"\b(he|she|they) (is|are) an?\b", r"\bbecause\b", r"\bcaus(e|es|ed|ing)\b", r"\bdue to\b",
    r"\blead(s)? to\b", r"\bresult(s|ed)? in\b", r"\bmakes? (you|me|them|him|her)\b", r"\babove average\b",
    r"\bbelow average\b", r"\b(ab)?normal\b", r"\b(un)?healthy\b", r"\bhigh\b", r"\blow\b", r"\bmost people\b",
    r"\bpopulation\b", r"\btypical(ly)?\b",
]

ALLOW_LIST = [config.DISCLAIMER, config.LIMITATIONS_TITLE] + list(config.LIMITATIONS)


def _strip_allowed(text: str) -> str:
    for allowed in ALLOW_LIST:
        text = text.replace(allowed, " ")
    return text


def lint(text: str, *, generalization: bool = False, observation: bool = False) -> List[str]:
    t = _strip_allowed(text or "").lower()
    patterns = list(BANNED)
    if generalization or observation:
        patterns += GENERALIZATION
    if observation:
        patterns += OBSERVATION_ONLY
    return [p for p in patterns if re.search(p, t)]


def schema_strings(node) -> Iterable[str]:
    """All description/title strings in a JSON Schema (consts like the disclaimer are not descriptions)."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("description", "title") and isinstance(v, str):
                yield v
            else:
                yield from schema_strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from schema_strings(v)
