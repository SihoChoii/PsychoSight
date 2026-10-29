"""Banned-terms lint for prompts, schema descriptions, report copy and observation text.

The fixed disclaimer and the limitations text are allow-listed: they must mention words like
"diagnosis" in negation. Code identifiers (e.g. message `attachments` in msgexport) are out of scope;
only human-readable copy is linted.

Matching is on a normalized copy (compatibility forms, invisible characters, dashes, and a few
Latin lookalikes folded) so zero-width and fullwidth tricks do not hide a banned word.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable, List

from . import config
from .experimental import strings as exp_strings

BANNED = [
    r"diagnos", r"disorder", r"clinical", r"\bt[\s-]*scores?\b", r"relapse", r"suicid", r"self[\s-]*harm",
    r"narcissis", r"impulsiv", r"\battachment\b", r"anxious attachment", r"\bavoidant\b", r"borderline",
    r"bipolar", r"depress", r"psychopath", r"sociopath", r"personality trait", r"\bpersonality\b",
    r"neuroticism", r"\bneo\b", r"neo[\s-]*pi", r"pid[\s-]*5", r"hitop", r"bi[\s-]*affect", r"entropy",
    r"kalman", r"1\.40", r"patholog", r"symptom", r"mental illness", r"\btoxic\b", r"gaslight", r"manipulat",
    r"elevat", r"\bcut[\s-]*offs?\b", r"\bpatient\b", r"\bpsychiatr", r"\bmedical\b", r"\bnorms?\b",
    r"\bpercentiles?\b",
]
# Generalization / trait / causal / norm wording, flagged in prompts and observations.
GENERALIZATION = [
    r"\balways\b", r"\bnever\b", r"is the type of person", r"tends to be",
    r"type[\s-]+of[\s-]+person", r"kind[\s-]+of[\s-]+person",
]
OBSERVATION_ONLY = [
    r"\btends?\s+to\b", r"type[\s-]+of[\s-]+person", r"kind[\s-]+of[\s-]+person", r"\bpersonality\b",
    r"\byou are an?\b", r"\b(he|she|they) (is|are) an?\b", r"\bbecause\b", r"\bcaus(e|es|ed|ing)\b",
    r"\bdue to\b", r"\blead(s)? to\b", r"\bresult(s|ed)? in\b", r"\bmakes? (you|me|them|him|her)\b",
    r"\b(?:above|below)[\s-]+average\b", r"\b(ab)?normal\b", r"\b(un)?healthy\b", r"\bhigh\b", r"\blow\b",
    r"\bmost people\b", r"\bpopulation\b", r"\btypical(ly)?\b",
]

# Lowercase Latin lookalikes folded only for the lint copy, not for stored report text.
_CONFUSABLES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ѕ": "s",
    "һ": "h", "ԁ": "d", "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ο": "o", "ρ": "p",
    "τ": "t", "υ": "u", "χ": "x", "ν": "v",
})
_INVISIBLE = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]")
_DASHES = re.compile(r"[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]")

ALLOW_LIST = [config.DISCLAIMER, config.LIMITATIONS_TITLE] + list(config.LIMITATIONS)


def _strip_allowed(text: str) -> str:
    for allowed in ALLOW_LIST:
        text = text.replace(allowed, " ")
    return text


def _normalize_for_lint(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = _INVISIBLE.sub("", text)
    text = _DASHES.sub("-", text)
    text = text.lower().translate(_CONFUSABLES)
    return re.sub(r"\s+", " ", text)


def lint(text: str, *, generalization: bool = False, observation: bool = False) -> List[str]:
    # Allow-list is exact, before normalization, so a zero-width character inside the
    # disclaimer does not hide the words it contains.
    t = _normalize_for_lint(_strip_allowed(text or ""))
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


# ---------- experimental scores section (schema 1.1.0) ----------
# Scoped allow-list: exact constants only. Applies only to strings under `experimental_scores` and to the
# exp-holistic-v1 prompt (Track B adds that prompt here). The global lint above is unchanged.
EXP_ALLOW_LIST: List[str] = list(exp_strings.ALLOW_LIST_CONSTANTS)

# Still banned inside the section (after allow-listed constants are stripped). Trait names are allowed there.
EXP_BANNED: List[str] = [
    r"diagnos", r"disorder", r"clinical", r"suicid", r"self[\s-]*harm", r"relapse", r"\bt[\s-]*scores?\b",
    r"\bpercentiles?\b", r"\bcut[\s-]*offs?\b", r"elevation", r"symptom", r"patholog",
    r"\byou (have|are) (a |an )?(narcissis|depress|addict|neurotic|anxious)",
    r"\b(is|are|am|an|a) addict(s|ed)?\b", r"\baddicts\b",
    r"\bat risk\b",
    r"\b(high|low)\b[^.]{0,20}\b(score|index|number)\b", r"\b(score|index|number)\b[^.]{0,20}\b(high|low)\b",
    r"\b(above|below)[\s-]+average\b",
]


def _strip_exp_allowed(text: str) -> str:
    # Longer constants first so a short allow-listed string cannot split a longer one.
    for allowed in sorted((a for a in EXP_ALLOW_LIST if a), key=len, reverse=True):
        text = text.replace(allowed, " ")
    return text


def lint_experimental(text: str) -> List[str]:
    """Return the EXP_BANNED patterns found in `text` after stripping EXP_ALLOW_LIST constants.

    The allow-list is exact and is applied before normalization, same as the global lint, so a
    zero-width character inside an allow-listed constant does not hide the words it contains.
    Callers replace a hit with the fixed fallback and log only the pattern (the rule id).
    """
    t = _normalize_for_lint(_strip_exp_allowed(text or ""))
    return [p for p in EXP_BANNED if re.search(p, t)]
