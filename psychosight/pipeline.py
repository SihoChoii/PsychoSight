"""End-to-end analysis: load -> sessionize -> features -> (opt-in) rubric scoring -> synthesis -> report."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import date, datetime, timezone
from typing import Callable, Optional

from . import config, features, loader, report, rubric, sessionize, synthesize
from .errors import LLMOptInRequired
from .llm import Provider, get_provider
from .storage import Store

log = logging.getLogger("psychosight.pipeline")

ProgressFn = Callable[[str, int, int], None]
STAGES = ("loading", "sessionizing", "features", "scoring", "synthesis", "done")


def _iso_now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


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
) -> dict:
    t0 = time.monotonic()
    created_at = _iso_now()
    report_id = report_id or uuid.uuid4().hex[:12]
    prog = progress or (lambda stage, cur, tot: None)
    if demo:
        conversation_id = config.DEMO_CONVERSATION_ID
    run_mode = resolve_mode(llm_opt_in, mode)
    is_demo = conversation_id == config.DEMO_CONVERSATION_ID
    if run_mode == "full" and provider is None:
        provider = get_provider(is_demo, llm_opt_in)  # fails fast if not configured
    store = store or Store()

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
    if run_mode == "full":
        selection = rubric.select_episodes(episodes)
        selected = [e for e in episodes if e.id in selection]
        if not selected:
            prog("scoring", 0, 0)
            rub = report.rubric_section("insufficient_data", "insufficient data", [], [], 0, 0, None,
                                        config.PROMPT_VERSION)
            obs = report.observations_section("insufficient_data", "insufficient data", [],
                                              config.SYNTHESIS_PROMPT_VERSION)
        else:
            scoring = rubric.score_episodes(provider, selected, store, llm_opt_in,
                                            progress=lambda c, t: prog("scoring", c, t))
            stats = scoring.stats
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
                                        sorted(scoring.runs), {e.id for e in episodes}, stats=stats)
            dropped_obs = obs.pop("_dropped", 0)
            used = {q for i in rub["items"] for q in i["quote_ids"]} | \
                   {q["quote_id"] for o in obs["items"] for q in o["quotes"]}
            quotes = [q for q in quotes if q["quote_id"] in used]
            prog("synthesis", 1, 1)
    else:
        rub = report.rubric_section("not_run", config.NOT_RUN_REASON, [], [], 0, 0, None, None)
        obs = report.observations_section("not_run", config.NOT_RUN_REASON, [], None)

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
        "reasoning_effort": provider.reasoning_effort if (provider and run_mode == "full") else None,
        "prompt_version": config.PROMPT_VERSION, "synthesis_prompt_version": config.SYNTHESIS_PROMPT_VERSION,
        "extractor_version": config.EXTRACTOR_VERSION, "backend_version": config.BACKEND_VERSION,
        "cache_hits": stats.cache_hits, "cache_misses": stats.cache_misses, "llm_calls": stats.llm_calls,
        "llm_retries": stats.llm_retries, "invalid_outputs": stats.invalid_outputs,
        "dropped_quotes": stats.dropped_quotes, "dropped_observations": dropped_obs,
        "thresholds": config.thresholds(),
    }
    rep = report.assemble(
        report_id=report_id, mode=run_mode, header=header, weeks=feats["weeks"], series=feats["series"],
        episodes=features.episode_index(episodes, feats["episode_stats"], selection), rubric=rub,
        observations=obs, quotes=quotes, run_meta=run_meta)
    if save:
        store.save_report(rep, hashes={e.id: e.hash for e in episodes})
    prog("done", 1, 1)
    log.info("run=%s done mode=%s episodes=%d scored=%d calls=%d cache_hits=%d", report_id, run_mode,
             len(episodes), rub["episodes_scored"], stats.llm_calls, stats.cache_hits)
    return rep


def _tz_name(msgs) -> str:
    if not msgs:
        return "local"
    tz = msgs[0].ts.tzinfo
    return getattr(tz, "key", None) or msgs[0].ts.tzname() or "local"
