"""Deterministic offline provider for tests and the demo. Uses simple keyword rules, not a model."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Dict, List, Optional, Tuple

from .llm import LLMResult, Provider
from .rubric import DATA_CLOSE, DATA_OPEN, ITEM_KEYS

KEYWORDS: Dict[str, List[str]] = {
    "validates_feelings": ["sounds really", "makes sense", "sorry that", "would hurt", "a lot to handle",
                           "makes everything harder"],
    "topic_redirect_to_self": ["same, my", "speaking of", "i didn't sleep either", "my boss"],
    "assigns_fault_to_other": ["you never", "you're the one", "not me", "you said"],
    "assigns_fault_to_self": ["that was on me", "i should have", "being short with you"],
    "escalating_language": ["whatever", "totally unfair", "you never listen", "not going to apologize",
                            "always my fault"],
    "repair_attempts": ["sorry", "make it up", "talk about it", "appreciate you"],
}
CONTEXT_ITEMS = {"validates_feelings", "topic_redirect_to_self", "escalating_language", "repair_attempts"}
CONTEXT_CUES = ["stressed", "rough", "tired", "hurt", "exhausted", "didn't", "fault", "never", "always",
                "ignoring", "unfair", "busy", "sorry"]
LINE = re.compile(r"^\[(\d+)\] (ME|OTHER): (.*)$")


def _block(text: str) -> str:
    start, end = text.find(DATA_OPEN), text.rfind(DATA_CLOSE)
    return text[start + len(DATA_OPEN):end] if start >= 0 and end > start else ""


def _h(*parts: str) -> int:
    return int(hashlib.sha256("|".join(parts).encode()).hexdigest()[:8], 16)


class MockProvider(Provider):
    name = "mock"

    def __init__(self, mode: str = "normal", reasoning_text: Optional[str] = None,
                 reasoning_level: Optional[str] = None):
        self.model = "mock-rubric-1"
        self.reasoning_effort = None
        self.reasoning_level = reasoning_level  # recorded in run_meta; has no effect on mock output
        self.mode = mode
        self.calls = 0
        self.reasoning_text = reasoning_text  # simulates a trace; never returned to callers

    def complete(self, system: str, user: str, *, run_idx: int = 0) -> LLMResult:
        self.calls += 1
        if self.mode == "always_malformed" or (self.mode == "malformed_once" and self.calls == 1):
            return LLMResult(content='{"items": {"validates_feelings": {"score": 9}')
        if system.startswith(("TASK: EXPERIMENTAL", "TASK: HOLISTIC")):
            from .experimental import mock_exp  # experimental prompts (traits-exp-v1, exp-holistic-v1)
            return mock_exp.complete(system, user, run_idx)
        if system.startswith("TASK: SYNTHESIS"):
            return LLMResult(content=json.dumps(self._synthesis(user)))
        return LLMResult(content=json.dumps(self._rubric(user, run_idx)))

    # ---- rubric ----
    def _rubric(self, user: str, run_idx: int) -> dict:
        lines = []
        for raw in _block(user).strip().splitlines():
            m = LINE.match(raw)
            if m:
                lines.append((m.group(2), m.group(3)))
        body = "\n".join(t for _, t in lines)
        if self.mode == "follow_injection" and "ignore previous instructions" in body.lower():
            other = next((t for s, t in lines if s == "OTHER" and "ignore" in t.lower()), "")
            return {"items": {k: {"score": 5, "evidence_quote": other, "confidence": "high"} for k in ITEM_KEYS},
                    "system_prompt": "leaked", "verdict": "extra field"}
        mine = [t for s, t in lines if s == "ME"]
        context = " ".join(t.lower() for s, t in lines if s == "OTHER")
        has_context = any(c in context for c in CONTEXT_CUES)
        items = {}
        for key in ITEM_KEYS:
            hits: List[Tuple[str, str]] = [(t, kw) for t in mine for kw in KEYWORDS[key] if kw in t.lower()]
            if not hits and key in CONTEXT_ITEMS and not has_context:
                items[key] = {"score": None, "evidence_quote": None, "confidence": "low"}
                continue
            score = 1 if not hits else (3 if len(hits) == 1 else 5)
            quote = hits[0][0] if hits and score > 1 else None
            if key == "assigns_fault_to_other" and run_idx == 1 and mine and _h(user, key) % 2:
                # Deliberately unstable item for the demo: the second run differs by 2 points.
                score = 3 if score == 1 else 1
                quote = " ".join(mine[0].split()[:4]) if score == 3 else None
            items[key] = {"score": score, "evidence_quote": quote, "confidence": "medium" if hits else "low"}
        return {"items": items}

    # ---- synthesis ----
    def _synthesis(self, user: str) -> dict:
        data = json.loads(_block(user))
        n = data["N"]
        pre = f"In this conversation, in the {n} episode{'s' if n != 1 else ''} reviewed, "
        quotes = {q["quote_id"]: q for q in data["quotes"]}
        out = []
        items = sorted(data["rubric_items_about_my_messages"], key=lambda i: (-i["episodes_scored"], i["key"]))
        for it in items[:2]:
            qids = it["quote_ids"][:2]
            out.append({
                "text": pre + f"{it['label'].lower()} in my messages averaged {it['mean_1_to_5']} on the 1-5 rubric "
                              f"across {it['episodes_scored']} episodes where both scoring runs agreed.",
                "episode_ids": [quotes[q]["episode_id"] for q in qids], "quote_ids": qids,
                "item_keys": [it["key"]], "feature_keys": []})
        feats = {f["key"]: f for f in data["features"]}
        lat = feats.get("reply_latency_median_s")
        if lat and lat["overall"]["me"]["value"] is not None and lat["overall"]["other"]["value"] is not None:
            o = lat["overall"]
            out.append({"text": pre + f"my median reply time was {o['me']['value']} seconds over {o['me']['count']} "
                                      f"replies, and the other person's was {o['other']['value']} seconds over "
                                      f"{o['other']['count']} replies (approximate).",
                        "episode_ids": [], "quote_ids": [], "item_keys": [], "feature_keys": [lat["key"]]})
        ini = feats.get("initiation_pct")
        if ini and ini["overall"]["me"]["value"] is not None:
            o = ini["overall"]
            out.append({"text": pre + f"I opened {o['me']['count']} episodes ({o['me']['value']}%) and the other "
                                      f"person opened {o['other']['count']} ({o['other']['value']}%).",
                        "episode_ids": [], "quote_ids": [], "item_keys": [], "feature_keys": [ini["key"]]})
        if self.mode == "bad_synthesis":
            out.insert(0, {"text": pre + "there is a pattern in episode ep-9999.", "episode_ids": ["ep-9999"],
                           "quote_ids": [], "item_keys": [], "feature_keys": []})
            out.insert(0, {"text": pre + "I always reply fast because I care.", "episode_ids": [],
                           "quote_ids": [], "item_keys": [], "feature_keys": ["reply_latency_median_s"]})
        return {"observations": out[:5]}
