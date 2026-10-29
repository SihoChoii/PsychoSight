"""End-to-end analysis: load -> sessionize -> features -> (opt-in) rubric scoring -> synthesis -> experimental -> report."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import date, datetime, timezone
from typing import Callable, Optional, Tuple

from . import config, features, loader, report, rubric, sessionize, synthesize
from .errors import ExperimentalConsentRequired, InvalidRequest, LLMOptInRequired
from .experimental.contract import (
    ENV_EXPERIMENTAL, EXP_HOLISTIC_PROMPT_VERSION, EXP_PROMPT_VERSION, EXP_SCORING_VERSION, ExpLLMStats,
)
from .experimental.section import not_run_section_or_shell, run_experimental
from .experimental import strings as exp_strings
from .llm import Provider, get_provider
from .storage import Store

log = logging.getLogger("psychosight.pipeline")

ProgressFn = Callable[[str, int, int], None]
# Full-mode order. Deterministic-only skips scoring and synthesis. The experimental stage is always
# emitted: empty (0/0) when the section is not requested or disabled, otherwise finished units
# (one per selected episode plus one per holistic speaker), not LLM calls.
STAGES = ("loading", "sessionizing", "features", "scoring", "synthesis", "experimental", "done")


def _iso_now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def experimental_enabled() -> bool:
    """False only when PSYCHOSIGHT_EXPERIMENTAL=0. Any other value, including unset, leaves the feature on."""
    return config._env(ENV_EXPERIMENTAL) != "0"


def resolve_experimental(is_demo: bool, experimental_scores: Optional[bool],
                         score_other: Optional[bool]) -> Tuple[bool, bool]:
    """Defaults: both false, except the demo opts in to both. score_other requires experimental scores.

    An omitted flag is ``None`` (apply the default). An explicit false stays false, including on the demo,
    so turning experimental scores off also turns off other-person scoring unless that flag is explicit.
    """
    experimental = is_demo if experimental_scores is None else bool(experimental_scores)
    if score_other is None:
        other = bool(is_demo and experimental)
    else:
        other = bool(score_other)
    if other and not experimental:
        raise ExperimentalConsentRequired(exp_strings.CONSENT_ERROR_MESSAGE)
    return experimental, other


def resolve_mode(llm_opt_in: bool, mode: Optional[str]) -> str:
    if mode == "full" and llm_opt_in is not True:
        raise LLMOptInRequired("mode 'full' needs llm_opt_in=true. Excerpts are only sent after explicit opt-in.")
    if mode == "deterministic_only":
        return "deterministic_only"
    return "full" if llm_opt_in is True else "deterministic_only"


def run_analysis(
    conversation_id: str,
    *,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    llm_opt_in: bool = False,
    demo: bool = False,
    mode: Optional[str] = None,
    report_id: Optional[str] = None,
    progress: Optional[ProgressFn] = None,
    store: Optional[Store] = None,
    provider: Optional[Provider] = None,
    save: bool = True,
    experimental_scores: Optional[bool] = None,
    score_other: Optional[bool] = None,
) -> dict:
    t0 = time.monotonic()
    created_at = _iso_now()
    report_id = report_id or uuid.uuid4().hex[:12]
    prog = progress or (lambda stage, cur, tot: None)
    if date_from and date_to and date_from > date_to:
        raise InvalidRequest("date_from must be on or before date_to.")
    if demo:
        conversation_id = config.DEMO_CONVERSATION_ID
    is_demo = demo or conversation_id == config.DEMO_CONVERSATION_ID
    experimental_on, score_other_on = resolve_experimental(is_demo, experimental_scores, score_other)
    run_mode = resolve_mode(llm_opt_in, mode)
    owns_provider = False
    if run_mode == "full" and provider is None:
        provider = get_provider(is_demo, llm_opt_in)  # fails fast if not configured
        owns_provider = True
    store = store or Store()
    budget = rubric.CallBudget(int(config._env("PSYCHOSIGHT_MAX_LLM_CALLS") or config.MAX_LLM_CALLS))

    try:
        prog("loading", 0, 1)
        data = loader.load_conversation(conversation_id, date_from, date_to)
        prog("loading", 1, 1)
        log.info("run=%s loaded messages=%d source=%s mode=%s", report_id, len(data.msgs), data.source, run_mode)

        prog("sessionizing", 0, 1)
        episodes = sessionize.sessionize(data.msgs)
        prog("sessionizing", 1, 1)

        prog("features", 0, 1)
        feats = features.compute(episodes)
        prog("features", 1, 1)

        stats = rubric.ScoringStats()
        selection: dict = {}
        quotes: list = []
        dropped_obs = 0
        # The experimental stage needs only the episodes, the selection and the features, so with a real
        # provider its model calls start now and overlap the main rubric and synthesis. It reads the
        # rubric-v1 cache rows (reused items for "me") only after the main rubric has finished.
        week_order = [w["week"] for w in feats["weeks"]]
        exp_enabled = experimental_enabled()
        exp_attempted = exp_enabled and experimental_on
        exp_speakers = ("me", "other") if score_other_on else ("me",)
        if run_mode == "full":
            selection = rubric.select_episodes(episodes)
        background = None
        if (exp_attempted and run_mode == "full" and provider is not None
                and getattr(provider, "name", None) != "mock" and config.exp_overlap()):
            background = _BackgroundExperimental(
                prog, episodes=episodes, selection=selection, provider=provider, store=store,
                speakers=exp_speakers, week_order=week_order)
            background.start()
        try:
            if run_mode == "full":
                selected = [e for e in episodes if e.id in selection]
                if not selected:
                    prog("scoring", 0, 0)
                    rub = report.rubric_section("insufficient_data", "insufficient data", [], [], 0, 0, None,
                                                config.PROMPT_VERSION)
                    obs = report.observations_section("insufficient_data", "insufficient data", [],
                                                      config.SYNTHESIS_PROMPT_VERSION)
                else:
                    scoring = rubric.score_episodes(provider, selected, store, llm_opt_in,
                                                    progress=lambda c, t: prog("scoring", c, t), budget=budget)
                    stats = scoring.stats
                    if background is not None:
                        background.rubric_done.set()  # rubric-v1 rows are cached; experimental may merge
                    by_id = {e.id: e for e in episodes}
                    week_of = {eid: feats["episode_stats"][eid]["week"] for eid in by_id}
                    items, quotes, agreement = rubric.aggregate(scoring, by_id, week_of, [w["week"] for w in feats["weeks"]])
                    n_scored = sum(1 for runs in scoring.runs.values() if runs[0] is not None and runs[1] is not None)
                    unstable = [i["key"] for i in items if i["status"] == "unstable"]
                    any_ok = any(i["status"] == "ok" for i in items)
                    rub = report.rubric_section("ok" if any_ok else "insufficient_data",
                                                None if any_ok else "insufficient data", items, unstable, len(selected),
                                                n_scored, agreement, config.PROMPT_VERSION)
                    prog("synthesis", 0, 1)
                    obs = synthesize.synthesize(provider, llm_opt_in, feats["series"], items, quotes, n_scored,
                                                sorted(scoring.runs), {e.id for e in episodes}, stats=stats,
                                                budget=budget)
                    dropped_obs = obs.pop("_dropped", 0)
                    used = {q for i in rub["items"] for q in i["quote_ids"]} | \
                           {q["quote_id"] for o in obs["items"] for q in o["quotes"]}
                    quotes = [q for q in quotes if q["quote_id"] in used]
                    prog("synthesis", 1, 1)
            else:
                rub = report.rubric_section("not_run", config.NOT_RUN_REASON, [], [], 0, 0, None, None)
                obs = report.observations_section("not_run", config.NOT_RUN_REASON, [], None)
        except BaseException:
            if background is not None:
                background.abort.set()
            raise
        finally:
            if background is not None:
                background.rubric_done.set()

        if not exp_attempted:
            prog("experimental", 0, 0)
            reason = exp_strings.REASON_DISABLED if not exp_enabled else exp_strings.REASON_NOT_REQUESTED
            exp_speakers = ("me", "other") if (experimental_on and score_other_on) else ("me",)
            exp_section = not_run_section_or_shell(reason, exp_speakers)
            exp_stats = ExpLLMStats()
        elif background is not None:
            exp_section, exp_stats = background.finish()
        else:
            # After synthesis when the LLM ran, and after features in deterministic-only mode.
            exp_selection = selection if run_mode == "full" else rubric.select_episodes(episodes)
            exp_section, exp_stats = run_experimental(
                episodes=episodes, selection=exp_selection, provider=provider, store=store,
                llm_ran=run_mode == "full", speakers=exp_speakers, week_order=week_order, progress=prog)

        words = {s: sum(e.word_counts.get(s, 0) for e in episodes) for s in ("me", "other")}
        msgs = {s: sum(1 for m in data.msgs if m.speaker == s) for s in ("me", "other")}
        local_dates = sorted(m.ts.date() for m in data.msgs)
        header = {
            "conversation_id": data.conversation_id, "conversation_label": data.label, "is_demo": data.is_demo,
            "date_from": local_dates[0].isoformat() if local_dates else None,
            "date_to": local_dates[-1].isoformat() if local_dates else None,
            "requested_range": {"date_from": date_from.isoformat() if date_from else None,
                                "date_to": date_to.isoformat() if date_to else None},
            "timezone": _tz_name(data.msgs), "message_counts": msgs, "word_counts": words,
            "episode_count": len(episodes), "episodes_scored": rub["episodes_scored"], "week_count": len(feats["weeks"]),
        }
        run_meta = {
            "run_id": report_id, "created_at": created_at, "finished_at": _iso_now(),
            "duration_s": round(time.monotonic() - t0, 3), "mode": run_mode, "llm_opt_in": bool(llm_opt_in is True),
            "source": data.source, "provider": provider.name if (provider and run_mode == "full") else None,
            "model": provider.model if (provider and run_mode == "full") else None,
            "provider_note": (config.demo_provider_note() or config.MOCK_NOTE_FORCED)
            if (provider and run_mode == "full" and provider.name == "mock") else None,
            "reasoning_effort": provider.reasoning_effort if (provider and run_mode == "full") else None,
            "prompt_version": config.PROMPT_VERSION, "synthesis_prompt_version": config.SYNTHESIS_PROMPT_VERSION,
            "extractor_version": config.EXTRACTOR_VERSION, "backend_version": config.BACKEND_VERSION,
            "cache_hits": stats.cache_hits, "cache_misses": stats.cache_misses, "llm_calls": stats.llm_calls,
            "llm_retries": stats.llm_retries, "invalid_outputs": stats.invalid_outputs,
            "dropped_quotes": stats.dropped_quotes, "dropped_observations": dropped_obs,
            "thresholds": config.thresholds(),
            "experimental_opt_in": experimental_on,
            "score_other_opt_in": score_other_on,
            "experimental_scoring_version": EXP_SCORING_VERSION if exp_attempted else None,
            "experimental_prompt_versions": (
                {"episode": EXP_PROMPT_VERSION, "holistic": EXP_HOLISTIC_PROMPT_VERSION} if exp_attempted else None),
            "experimental_llm_calls": exp_stats.llm_calls if exp_attempted else 0,
            "experimental_cache_hits": exp_stats.cache_hits if exp_attempted else 0,
        }
        rep = report.assemble(
            report_id=report_id, mode=run_mode, header=header, weeks=feats["weeks"], series=feats["series"],
            episodes=features.episode_index(episodes, feats["episode_stats"], selection), rubric=rub,
            observations=obs, quotes=quotes, run_meta=run_meta, experimental_scores=exp_section)
        if save:
            store.save_report(rep, hashes={e.id: e.hash for e in episodes})
        prog("done", 1, 1)
        usage = getattr(provider, "usage_totals", None) if run_mode == "full" else None
        if usage:
            log.info("run=%s token usage calls=%d prompt=%d completion=%d reasoning=%d", report_id, usage["calls"],
                     usage["prompt_tokens"], usage["completion_tokens"], usage["reasoning_tokens"])
        log.info("run=%s done mode=%s episodes=%d scored=%d calls=%d cache_hits=%d experimental=%s exp_calls=%d",
                 report_id, run_mode, len(episodes), rub["episodes_scored"], stats.llm_calls, stats.cache_hits,
                 exp_section.get("status"), exp_stats.llm_calls if exp_attempted else 0)
        return rep
    finally:
        if owns_provider and provider is not None:
            closer = getattr(provider, "close", None)
            if closer:
                closer()


class _BackgroundExperimental:
    """Runs ``run_experimental`` on a worker thread that starts before the main rubric.

    Progress from the worker is held back while the main stages run (the job keeps one current
    stage), then the latest value is shown when :meth:`finish` is called after synthesis.
    """

    def __init__(self, prog: ProgressFn, **kwargs):
        self._prog = prog
        self._kwargs = kwargs
        self.rubric_done = threading.Event()
        self.abort = threading.Event()
        self._lock = threading.Lock()
        self._live = False
        self._latest = None
        self._result = None
        self._thread = threading.Thread(target=self._run, name="psychosight-experimental", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def _progress(self, stage: str, cur: int, tot: int) -> None:
        with self._lock:
            if self._live:
                self._prog(stage, cur, tot)
            else:
                self._latest = (stage, cur, tot)

    def _run(self) -> None:
        speakers = self._kwargs["speakers"]
        try:
            self._result = run_experimental(
                episodes=self._kwargs["episodes"], selection=self._kwargs["selection"],
                provider=self._kwargs["provider"], store=self._kwargs["store"], llm_ran=True,
                speakers=speakers, week_order=self._kwargs["week_order"], progress=self._progress,
                before_merge=self.rubric_done.wait, abort=self.abort)
        except BaseException as exc:  # noqa: BLE001 - run_experimental never raises; belt and braces
            log.warning("experimental background stage failed type=%s", type(exc).__name__)
            from .experimental.section import _failed_section
            self._result = (_failed_section(speakers), ExpLLMStats())

    def finish(self):
        with self._lock:
            self._live = True
            if self._latest is not None:
                self._prog(*self._latest)
        self._thread.join()
        return self._result


def _tz_name(msgs) -> str:
    if not msgs:
        return "local"
    tz = msgs[0].ts.tzinfo
    return getattr(tz, "key", None) or msgs[0].ts.tzname() or "local"
