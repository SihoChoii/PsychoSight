"""Fakes for Tracks A–C. Track D tests patch these over the contract stubs.

The real modules are merged and used by the pipeline and end-to-end tests. Wiring tests still
install these fakes so they can check call order, arguments and failure handling in isolation.
"""

from __future__ import annotations

from datetime import datetime, timezone

from psychosight.experimental import deterministic, llm_exp, scoring
from psychosight.experimental.contract import EXP_SEED, DeterministicResult, ExpLLMResult, ExpLLMStats
from psychosight.experimental.section import shell_section
from psychosight.models import Episode, Msg, Turn


def make_episode(episode_id: str = "ep1", me_text: str = "hello from me today") -> Episode:
    ts = datetime(2025, 10, 1, 15, 0, tzinfo=timezone.utc)
    me = Msg(id=episode_id + "-m", ts=ts, speaker="me", text=me_text)
    other = Msg(id=episode_id + "-o", ts=ts, speaker="other", text="hello")
    turns = [Turn("me", [me]), Turn("other", [other])]
    return Episode(id=episode_id, turns=turns, hash="h-" + episode_id, word_counts={"me": 4, "other": 1})


class FakeTracks:
    """Records calls and returns a schema-valid section, or raises on a chosen step."""

    def __init__(self):
        self.det_calls = []
        self.llm_calls = []
        self.build_calls = []
        self.raise_on = None
        self.error = NotImplementedError("track stub")
        self.bad_label = None
        self.sentinel = "wiring-ok"
        self.invalid = False
        self.quote_text = None

    def compute_deterministic(self, episodes, speakers):
        self.det_calls.append({"episodes": list(episodes or []), "speakers": tuple(speakers)})
        if self.raise_on == "det":
            raise self.error
        return DeterministicResult(
            observations=[],
            words={s: 0 for s in speakers},
            episodes_with_speaker={s: 0 for s in speakers},
            unavailable={},
        )

    def score_llm(self, provider, selected, store, *, speakers, budget, progress=None, holistic=True):
        self.llm_calls.append({
            "provider": provider, "selected": list(selected), "store": store, "speakers": tuple(speakers),
            "budget": budget, "holistic": holistic,
        })
        if progress is not None:
            progress(1, 2)
        if self.raise_on == "llm":
            raise self.error
        return ExpLLMResult(
            status="ok", reason=None, observations=[], agreeing_episodes={}, agreement_rate={},
            unstable_items={}, holistic={}, quotes=[],
            stats=ExpLLMStats(llm_calls=3, llm_retries=1, invalid_outputs=0, cache_hits=4, cache_misses=5),
        )

    def build_section(self, det, llm, episodes, week_order, *, speakers, llm_ran, seed=EXP_SEED):
        self.build_calls.append({
            "det": det, "llm": llm, "episodes": episodes, "week_order": list(week_order),
            "speakers": tuple(speakers), "llm_ran": llm_ran, "seed": seed,
        })
        if self.raise_on == "build":
            raise self.error
        if self.invalid:
            return {"status": "nope"}
        section = shell_section("not_run", "wiring", speakers)
        section["dimensions"][0]["per_speaker"]["me"]["contributions"][0]["anchor_source"] = self.sentinel
        if self.bad_label:
            section["dimensions"][0]["per_speaker"]["me"]["contributions"][0]["label"] = self.bad_label
        if self.quote_text:
            section["quotes"] = [{
                "id": "xq_001", "speaker": "me", "episode_id": "ep-0001", "marker_key": "i_rate",
                "text": self.quote_text, "ts": "2025-10-01T15:00:00+00:00",
            }]
        return section

    def install(self, monkeypatch):
        monkeypatch.setattr(deterministic, "compute_deterministic", self.compute_deterministic)
        monkeypatch.setattr(llm_exp, "score_llm", self.score_llm)
        monkeypatch.setattr(scoring, "build_section", self.build_section)
