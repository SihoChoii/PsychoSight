"""Speed-up paths must not change results: parallel runs, higher concurrency, overlap with the main rubric."""

from __future__ import annotations

import random
import threading
import time

import httpx
import pytest

from psychosight import config, pipeline, rubric
from psychosight.experimental.llm_exp import score_llm
from psychosight.llm import DeepSeekProvider, LLMResult, _retry_wait
from psychosight.mock_provider import MockProvider
from psychosight.rubric import CallBudget
from psychosight.storage import Store
from tests.test_exp_llm import fixed_episode, make_ep
from tests.test_llm import ok_response, settings


class Threaded:
    """Thread-safe stand-in with a non-mock name, so the real worker pools are used."""

    name = "deepseek"
    model = "threaded-model"

    def __init__(self, fn, delay=0.0, seed=0):
        self.fn = fn
        self.delay = delay
        self._rng = random.Random(seed)
        self._lock = threading.Lock()
        self.calls = 0

    def complete(self, system, user, *, run_idx=0):
        with self._lock:
            self.calls += 1
            pause = self._rng.random() * self.delay
        if pause:
            time.sleep(pause)
        return LLMResult(content=self.fn(system, user, run_idx))


def _episodes(n):
    return [make_ep([("me", f"hello there friend number {i}, I worry about it"), ("other", "ok sure thing")],
                    eid=f"ep-{i:04d}") for i in range(n)]


def _varying(name, key, run_idx):
    return 2 + (len(key) + run_idx) % 3


def test_exp_concurrency_default_and_override(monkeypatch):
    monkeypatch.delenv("PSYCHOSIGHT_EXP_LLM_CONCURRENCY", raising=False)
    assert config.EXP_LLM_CONCURRENCY == 24 and config.exp_llm_concurrency() == 24
    monkeypatch.setenv("PSYCHOSIGHT_EXP_LLM_CONCURRENCY", "3")
    assert config.exp_llm_concurrency() == 3
    monkeypatch.setenv("PSYCHOSIGHT_EXP_LLM_CONCURRENCY", "0")
    assert config.exp_llm_concurrency() == 1


def test_both_runs_of_one_episode_are_in_flight_together(tmp_path):
    barrier = threading.Barrier(2)
    met = []

    def fn(system, user, run_idx):
        try:
            barrier.wait(timeout=3)
            met.append(run_idx)
        except threading.BrokenBarrierError:
            pass
        return fixed_episode(3)(system, user, run_idx)

    result = score_llm(Threaded(fn), _episodes(1), Store(tmp_path / "s.db"), speakers=("me",),
                       budget=CallBudget(10), holistic=False)
    assert sorted(met) == [0, 1]
    assert result.stats.llm_calls == 2


def test_exp_in_flight_calls_follow_the_setting(tmp_path, monkeypatch):
    monkeypatch.setenv("PSYCHOSIGHT_EXP_LLM_CONCURRENCY", "4")
    lock = threading.Lock()
    state = {"now": 0, "max": 0}

    def fn(system, user, run_idx):
        with lock:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
        time.sleep(0.05)
        with lock:
            state["now"] -= 1
        return fixed_episode(3)(system, user, run_idx)

    score_llm(Threaded(fn), _episodes(6), Store(tmp_path / "s.db"), speakers=("me",), budget=CallBudget(50),
              holistic=False)
    assert state["max"] == 4


def _comparable(result):
    return (
        [(o.marker_id, o.speaker, o.episode_id, o.num, o.week) for o in result.observations],
        [(q.marker_id, q.speaker, q.episode_id, q.msg_idx, q.start, q.end) for q in result.quotes],
        result.agreeing_episodes, result.agreement_rate, result.unstable_items, result.holistic,
        result.stats.llm_calls, result.reason,
    )


def test_completion_order_does_not_change_results(tmp_path, monkeypatch):
    episodes = _episodes(10)
    fn = fixed_episode(_varying)
    monkeypatch.setenv("PSYCHOSIGHT_EXP_LLM_CONCURRENCY", "1")
    serial = score_llm(Threaded(fn), episodes, Store(tmp_path / "a.db"), speakers=("me", "other"),
                       budget=CallBudget(110), holistic=True)
    monkeypatch.setenv("PSYCHOSIGHT_EXP_LLM_CONCURRENCY", "16")
    for seed in (1, 2):
        shuffled = score_llm(Threaded(fn, delay=0.02, seed=seed), episodes, Store(tmp_path / f"b{seed}.db"),
                             speakers=("me", "other"), budget=CallBudget(110), holistic=True)
        assert _comparable(shuffled) == _comparable(serial)


def test_before_merge_runs_after_every_call(tmp_path):
    provider = Threaded(fixed_episode(3), delay=0.01)
    seen = []
    score_llm(provider, _episodes(3), Store(tmp_path / "s.db"), speakers=("me", "other"), budget=CallBudget(50),
              holistic=True, before_merge=lambda: seen.append(provider.calls))
    assert seen == [3 * 2 + 2 * 2]


def test_abort_stops_new_calls(tmp_path):
    abort = threading.Event()
    abort.set()
    provider = Threaded(fixed_episode(3))
    result = score_llm(provider, _episodes(3), Store(tmp_path / "s.db"), speakers=("me",), budget=CallBudget(50),
                       holistic=True, abort=abort)
    assert provider.calls == 0 and result.observations == []


def test_rubric_runs_in_parallel_and_keeps_episode_order(tmp_path):
    barrier = threading.Barrier(2)
    met = []
    mock = MockProvider()

    class Rub:
        name = "deepseek"
        model = mock.model

        def complete(self, system, user, *, run_idx=0):
            try:
                barrier.wait(timeout=3)
                met.append(run_idx)
            except threading.BrokenBarrierError:
                pass
            return mock.complete(system, user, run_idx=run_idx)

    episodes = _episodes(1)
    out = rubric.score_episodes(Rub(), episodes, Store(tmp_path / "s.db"), True, concurrency=2)
    assert sorted(met) == [0, 1]
    serial = rubric.score_episodes(MockProvider(), episodes, Store(tmp_path / "t.db"), True)
    assert out.runs == serial.runs


class ParallelMock:
    """MockProvider answers behind a non-mock name, so the pipeline takes the real-provider paths."""

    name = "deepseek"
    reasoning_effort = None

    def __init__(self, on_call=None):
        self._mock = MockProvider()
        self.model = self._mock.model
        self._lock = threading.Lock()
        self.on_call = on_call

    def complete(self, system, user, *, run_idx=0):
        if self.on_call:
            self.on_call(system)
        with self._lock:
            return self._mock.complete(system, user, run_idx=run_idx)


def _demo(tmp_path, name, provider, monkeypatch, overlap):
    monkeypatch.setenv("PSYCHOSIGHT_EXP_OVERLAP", "1" if overlap else "0")
    stages = []
    rep = pipeline.run_analysis("demo", demo=True, llm_opt_in=True, store=Store(tmp_path / f"{name}.db"),
                                provider=provider, save=False, experimental_scores=True, score_other=True,
                                report_id="r1", progress=lambda s, c, t: stages.append((s, c, t)))
    return rep, stages


def _sections(rep):
    return {k: rep[k] for k in ("experimental_scores", "rubric", "observations", "quotes", "header")}


def test_overlap_gives_the_same_report_and_stage_order(tmp_path, monkeypatch):
    seq, seq_stages = _demo(tmp_path, "seq", ParallelMock(), monkeypatch, overlap=False)
    par, par_stages = _demo(tmp_path, "par", ParallelMock(), monkeypatch, overlap=True)
    assert _sections(par) == _sections(seq)
    assert par["experimental_scores"]["status"] == "ok"
    assert par["run_meta"]["experimental_llm_calls"] == seq["run_meta"]["experimental_llm_calls"] > 0
    names = [s for s, _c, _t in par_stages]
    last_synthesis = max(i for i, s in enumerate(names) if s == "synthesis")
    first_exp = min(i for i, s in enumerate(names) if s == "experimental")
    assert first_exp > last_synthesis and names[-1] == "done"
    exp_events = [(c, t) for s, c, t in par_stages if s == "experimental"]
    assert exp_events[-1][0] == exp_events[-1][1]


def test_overlap_starts_experimental_calls_before_the_rubric_finishes(tmp_path, monkeypatch):
    exp_seen = threading.Event()
    rubric_waited = []

    def on_call(system):
        if system.startswith("TASK: EXPERIMENTAL") or system.startswith("TASK: HOLISTIC"):
            exp_seen.set()
        elif system == rubric.SYSTEM_PROMPT and not rubric_waited:
            rubric_waited.append(exp_seen.wait(timeout=10))

    rep, _stages = _demo(tmp_path, "early", ParallelMock(on_call), monkeypatch, overlap=True)
    assert rubric_waited and all(rubric_waited)  # the first rubric calls saw an experimental call
    assert rep["experimental_scores"]["status"] == "ok"


def test_overlap_is_off_for_the_mock_provider(tmp_path, monkeypatch):
    started = []
    real = pipeline._BackgroundExperimental.start
    monkeypatch.setattr(pipeline._BackgroundExperimental, "start", lambda self: (started.append(1), real(self)))
    monkeypatch.setenv("PSYCHOSIGHT_EXP_OVERLAP", "1")
    pipeline.run_analysis("demo", demo=True, llm_opt_in=True, store=Store(tmp_path / "m.db"), save=False,
                          experimental_scores=True, score_other=True)
    assert started == []


def test_main_failure_aborts_background_experimental(tmp_path, monkeypatch):
    from psychosight.errors import LLMUnavailable

    calls = {"exp": 0}

    class Failing(ParallelMock):
        def complete(self, system, user, *, run_idx=0):
            if system == rubric.SYSTEM_PROMPT:
                raise LLMUnavailable("down")
            calls["exp"] += 1
            return super().complete(system, user, run_idx=run_idx)

    monkeypatch.setenv("PSYCHOSIGHT_EXP_OVERLAP", "1")
    with pytest.raises(LLMUnavailable):
        pipeline.run_analysis("demo", demo=True, llm_opt_in=True, store=Store(tmp_path / "f.db"), save=False,
                              provider=Failing(), experimental_scores=True, score_other=True)


def test_retry_wait_honors_retry_after_and_backs_off():
    assert _retry_wait(httpx.Response(429, headers={"retry-after": "7"}), 0) == 7.0
    assert _retry_wait(httpx.Response(429, headers={"retry-after": "999"}), 0) == 60.0
    for attempt, base in ((0, 1), (2, 4), (6, 30)):
        wait = _retry_wait(httpx.Response(503), attempt)
        assert base <= wait <= base * 1.5


def test_rate_limited_requests_retry_with_backoff():
    calls = {"n": 0}
    slept = []

    def handler(request):
        calls["n"] += 1
        return httpx.Response(429, headers={"retry-after": "2"}) if calls["n"] < 5 else ok_response("{}")

    p = DeepSeekProvider(settings(), transport=httpx.MockTransport(handler), sleep=slept.append)
    assert p.complete("s", "u").content == "{}"
    assert calls["n"] == 5 and slept == [2.0] * 4
