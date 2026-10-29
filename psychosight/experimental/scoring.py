"""Track C: pooling, sub-scores, caps, index, bootstrap band, gating, confidence, trend, contributions.

Scoring rules are plan section 3.5. Anchors are fixed in ``data/exp_anchors_v1.json`` and are never
fitted to the conversation. Output is a schema 1.1.0 ``experimental_scores`` object.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Optional, Sequence, Tuple

from ..features import tokenize, week_key
from ..resources import package_dir
from ..models import Episode
from . import strings
from .contract import (
    DIMENSIONS,
    DIRECTION_CODES,
    EVIDENCE_BAND_PENALTY,
    EXP_ANCHORS_VERSION,
    EXP_BAND_HI_PCT,
    EXP_BAND_LO_PCT,
    EXP_BOOTSTRAP,
    EXP_HOLISTIC_PROMPT_VERSION,
    EXP_MAX_CONFIDENCE,
    EXP_MAX_QUOTES_PER_CONTRIBUTION,
    EXP_MEDIUM_AGREEMENT,
    EXP_MEDIUM_EPISODES,
    EXP_MEDIUM_WORDS,
    EXP_MIN_EPISODES,
    EXP_MIN_MARKERS_WITH_DATA,
    EXP_MIN_WORDS,
    EXP_NO_LLM_BAND_PENALTY,
    EXP_PROMPT_VERSION,
    EXP_SCORING_VERSION,
    EXP_SEED,
    EXP_TREND_MIN_EPISODES,
    EXP_TREND_MIN_WORDS,
    SOURCE_CODES,
    DeterministicResult,
    ExpLLMResult,
    ExpQuote,
    Marker,
    markers_for,
)

_ANCHORS_PATH = package_dir() / "experimental" / "data" / "exp_anchors_v1.json"
_PERCENT_UNITS = frozenset(("% of words", "% of messages"))
_WEEK_RE = re.compile(r"^[0-9]{4}-W[0-9]{2}$")
_SPEAKER_ORDER = ("me", "other")


@dataclass
class _Cell:
    num: float
    den: float
    week: str


@dataclass
class _ResolvedQuote:
    speaker: str
    episode_id: str
    marker_id: str
    text: str
    ts: str
    msg_idx: int
    start: int
    end: int
    pos: int


@dataclass
class _Ctx:
    det: DeterministicResult
    llm: Optional[ExpLLMResult]
    episodes: List[Episode]
    episodes_by_id: Dict[str, Episode]
    week_order: List[str]
    score_me: bool
    score_other: bool
    llm_ran: bool
    seed: int
    anchors: Dict[str, dict]
    cells: Dict[Tuple[str, str], Dict[str, _Cell]] = field(default_factory=dict)
    unstable: Dict[str, set] = field(default_factory=dict)
    quotes_by_marker: Dict[Tuple[str, str], List[_ResolvedQuote]] = field(default_factory=dict)
    quotes_out: List[dict] = field(default_factory=list)
    quote_ids: Dict[tuple, str] = field(default_factory=dict)
    quote_n: int = 1


def build_section(
    det: DeterministicResult,
    llm: Optional[ExpLLMResult],
    episodes: List[Episode],
    week_order: List[str],
    *,
    speakers: Sequence[str],
    llm_ran: bool,
    seed: int = EXP_SEED,
) -> dict:
    """Return a schema-valid ``experimental_scores`` dict."""
    ctx = _prepare(det, llm, episodes, week_order, speakers=speakers, llm_ran=llm_ran, seed=seed)
    dimensions: List[dict] = []
    speaker_rows: List[Tuple[str, Optional[str]]] = []
    for dim in DIMENSIONS:
        per: Dict[str, Optional[dict]] = {}
        markers = markers_for(dim.key)
        if ctx.score_me:
            per["me"] = _speaker_block(ctx, dim, markers, "me")
            speaker_rows.append((per["me"]["status"], per["me"]["reason"]))
        else:
            per["me"] = _not_run_speaker(strings.REASON_NOT_REQUESTED, markers, ctx.anchors)
            speaker_rows.append((per["me"]["status"], per["me"]["reason"]))
        if ctx.score_other:
            per["other"] = _speaker_block(ctx, dim, markers, "other")
            speaker_rows.append((per["other"]["status"], per["other"]["reason"]))
        else:
            per["other"] = None
        dimensions.append({
            "key": dim.key,
            "label": dim.label,
            "family": dim.family,
            "evidence_strength": dim.evidence_strength,
            "evidence_note": dim.evidence_note,
            "citations": [{"short": c.short, "doi": c.doi} for c in dim.citations],
            "per_speaker": per,
        })
    status, reason = _section_status(speaker_rows)
    return _shell(status, reason, _speakers_scored(ctx.score_other), dimensions, ctx.quotes_out)


def not_run_section(reason: str, speakers: Sequence[str] = ("me",)) -> dict:
    """Same shape as ``build_section`` with every scored speaker ``not_run`` and the given reason."""
    anchors = _anchor_map()
    score_other = "other" in set(speakers)
    dimensions: List[dict] = []
    for dim in DIMENSIONS:
        markers = markers_for(dim.key)
        per: Dict[str, Optional[dict]] = {
            "me": _not_run_speaker(reason, markers, anchors),
            "other": _not_run_speaker(reason, markers, anchors) if score_other else None,
        }
        dimensions.append({
            "key": dim.key,
            "label": dim.label,
            "family": dim.family,
            "evidence_strength": dim.evidence_strength,
            "evidence_note": dim.evidence_note,
            "citations": [{"short": c.short, "doi": c.doi} for c in dim.citations],
            "per_speaker": per,
        })
    return _shell("not_run", reason, _speakers_scored(score_other), dimensions, [])


# ---------------------------------------------------------------- anchors and pure math


@lru_cache(maxsize=1)
def _load_anchors() -> dict:
    data = json.loads(_ANCHORS_PATH.read_text(encoding="utf-8"))
    if data.get("anchors_version") != EXP_ANCHORS_VERSION:
        raise ValueError(f"anchors_version must be {EXP_ANCHORS_VERSION}")
    markers = data.get("markers") or {}
    missing = [m.id for m in markers_for_all() if m.id not in markers]
    if missing:
        raise ValueError("anchors file is missing marker ids: " + ", ".join(missing))
    return data


def markers_for_all() -> Tuple[Marker, ...]:
    """Unique marker ids are checked by walking the registry; duplicates across dimensions are fine."""
    from .contract import MARKERS
    return MARKERS


def _anchor_map() -> Dict[str, dict]:
    return _load_anchors()["markers"]


def _to_value(num: float, den: float, unit: str) -> float:
    """Pooled ``num/den``. Percent units are reported on a 0-100 percentage scale."""
    value = num / den
    if unit in _PERCENT_UNITS:
        value *= 100.0
    return value


def _subscore(value: float, marker: Marker, anchor: dict) -> float:
    """Map a raw marker value onto 0-1. Down markers are flipped after the raw map."""
    if marker.requires_wwbp:
        center = float(anchor["c"])
        scale = float(anchor["k"])
        if scale == 0.0:
            score = 1.0 if value >= center else 0.0
        else:
            z = (value - center) / scale
            if z >= 60.0:
                score = 1.0
            elif z <= -60.0:
                score = 0.0
            else:
                score = 1.0 / (1.0 + math.exp(-z))
    else:
        lo = float(anchor["lo"])
        hi = float(anchor["hi"])
        span = hi - lo
        if span == 0.0:
            score = 0.0
        else:
            score = (value - lo) / span
        if score < 0.0:
            score = 0.0
        elif score > 1.0:
            score = 1.0
    if marker.direction < 0:
        score = 1.0 - score
    return score


def _effective_shares(present: Sequence[Marker]) -> Dict[str, float]:
    """Normalize registry weights, clip H/R caps once, redistribute, then renormalize.

    Receivers are markers that were not clipped on this pass (deterministic markers, and any
    rubric or holistic marker already at or under its cap). One pass only: a receiver that the
    excess pushes over its cap is not clipped again. If every marker was clipped, renormalizing
    is what makes the shares sum to 1; that case has no deterministic marker, so the index is
    not shown.
    """
    if not present:
        return {}
    total = sum(m.weight for m in present)
    if total <= 0.0:
        return {m.id: 0.0 for m in present}
    shares = {m.id: m.weight / total for m in present}
    excess = 0.0
    receivers: List[str] = []
    for marker in present:
        cap = marker.cap_share
        if cap is not None and shares[marker.id] > cap + 1e-12:
            excess += shares[marker.id] - cap
            shares[marker.id] = float(cap)
        else:
            receivers.append(marker.id)
    if excess > 0.0 and receivers:
        base = sum(shares[mid] for mid in receivers)
        if base > 0.0:
            for mid in receivers:
                shares[mid] += excess * (shares[mid] / base)
        else:
            add = excess / float(len(receivers))
            for mid in receivers:
                shares[mid] += add
    norm = sum(shares.values())
    if norm > 0.0:
        shares = {mid: weight / norm for mid, weight in shares.items()}
    return shares


def _display_weights(exact: Dict[str, float]) -> Dict[str, float]:
    """Round effective shares to thousandths so an ok speaker's weights sum to 1."""
    if not exact:
        return {}
    if len(exact) == 1:
        only = next(iter(exact))
        return {only: 1.0}
    ids = list(exact)
    scaled = [exact[mid] * 1000.0 for mid in ids]
    floors = [int(math.floor(value + 1e-6)) for value in scaled]
    leftover = 1000 - sum(floors)
    if leftover > 0:
        order = sorted(range(len(ids)), key=lambda i: (-(scaled[i] - floors[i]), i))
        for step in range(leftover):
            floors[order[step % len(order)]] += 1
    elif leftover < 0:
        order = sorted(range(len(ids)), key=lambda i: ((scaled[i] - floors[i]), i))
        for step in range(-leftover):
            floors[order[step % len(order)]] -= 1
    out: Dict[str, float] = {}
    for i, mid in enumerate(ids):
        weight = floors[i] / 1000.0
        if weight < 0.0:
            weight = 0.0
        elif weight > 1.0:
            weight = 1.0
        if weight == 0.0:
            weight = 0.0
        out[mid] = weight
    return out


def _score_from_values(markers: Sequence[Marker], values: Dict[str, float], anchors: Dict[str, dict],
                       ) -> Tuple[Optional[int], Dict[str, float], Dict[str, float]]:
    """Index over markers that have a value. ``None`` when the >=2 and >=1 deterministic rule fails."""
    present = [m for m in markers if m.id in values]
    shares = _effective_shares(present)
    subs = {m.id: _subscore(values[m.id], m, anchors[m.id]) for m in present}
    d_count = sum(1 for m in present if m.source == "deterministic")
    if len(present) < EXP_MIN_MARKERS_WITH_DATA or d_count < 1:
        return None, shares, subs
    weighted = 0.0
    weight_sum = 0.0
    for marker in present:
        weight = shares[marker.id]
        weighted += weight * subs[marker.id]
        weight_sum += weight
    if weight_sum <= 0.0:
        return None, shares, subs
    score = int(round(100.0 * weighted / weight_sum))
    if score < 0:
        score = 0
    elif score > 100:
        score = 100
    return score, shares, subs


def _percentile(values: Sequence[float], p: float) -> float:
    """Linear percentile (Hyndman-Fan type 7, the usual inclusive rank). ``p`` is 0-1."""
    if not values:
        raise ValueError("percentile of an empty sample")
    ordered = sorted(values)
    n = len(ordered)
    if n == 1:
        return float(ordered[0])
    rank = (n - 1) * p
    lo = int(math.floor(rank))
    hi = lo + 1 if lo + 1 < n else lo
    frac = rank - lo
    return ordered[lo] * (1.0 - frac) + ordered[hi] * frac


def _evidence_penalty(strength: str, llm_ran: bool) -> int:
    penalty = EVIDENCE_BAND_PENALTY[strength]
    if not llm_ran:
        penalty += EXP_NO_LLM_BAND_PENALTY
    return penalty


def _clamp_int(value: float) -> int:
    if value < 0.0:
        value = 0.0
    elif value > 100.0:
        value = 100.0
    rounded = int(round(value))
    if rounded < 0:
        return 0
    if rounded > 100:
        return 100
    return rounded


def _r3(value: float) -> float:
    rounded = round(float(value), 3)
    if rounded == 0:
        return 0.0
    return rounded


def _r3_unit(value: float) -> float:
    rounded = _r3(value)
    if rounded < 0.0:
        return 0.0
    if rounded > 1.0:
        return 1.0
    return rounded


def _bootstrap_rng(seed: int, speaker: str, dimension: str) -> random.Random:
    """Independent stream per speaker and dimension, still fully determined by ``seed``."""
    digest = hashlib.sha256(f"{seed}|{speaker}|{dimension}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


# ---------------------------------------------------------------- assembly


def _prepare(det: DeterministicResult, llm: Optional[ExpLLMResult], episodes: List[Episode],
             week_order: List[str], *, speakers: Sequence[str], llm_ran: bool, seed: int) -> _Ctx:
    wanted = set(speakers)
    score_me = "me" in wanted
    score_other = "other" in wanted
    if not score_me and not score_other:
        score_me = True
    ctx = _Ctx(
        det=det,
        llm=llm if llm_ran else None,
        episodes=list(episodes),
        episodes_by_id={ep.id: ep for ep in episodes},
        week_order=[w for w in week_order if isinstance(w, str)],
        score_me=score_me,
        score_other=score_other,
        llm_ran=bool(llm_ran),
        seed=int(seed),
        anchors=_anchor_map(),
    )
    if llm_ran and llm is not None:
        for speaker, items in (llm.unstable_items or {}).items():
            ctx.unstable[speaker] = set(items or ())
    _collect_observations(ctx, det.observations, from_llm=False)
    if llm_ran and llm is not None:
        _collect_observations(ctx, llm.observations, from_llm=True)
        _collect_quotes(ctx, llm.quotes)
    return ctx


def _finite(value: float) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _collect_observations(ctx: _Ctx, observations, *, from_llm: bool) -> None:
    unavailable = ctx.det.unavailable or {}
    for obs in observations:
        if from_llm:
            if not obs.marker_id.startswith("llm."):
                continue
            item = obs.marker_id[4:]
            if item in ctx.unstable.get(obs.speaker, ()):
                continue
        elif obs.marker_id in unavailable:
            continue
        if not _finite(obs.num) or not _finite(obs.den) or float(obs.den) <= 0.0:
            continue
        bucket = ctx.cells.setdefault((obs.speaker, obs.marker_id), {})
        cell = bucket.get(obs.episode_id)
        if cell is None:
            bucket[obs.episode_id] = _Cell(float(obs.num), float(obs.den), str(obs.week))
        else:
            cell.num += float(obs.num)
            cell.den += float(obs.den)


def _collect_quotes(ctx: _Ctx, quotes: Sequence[ExpQuote]) -> None:
    positions = {ep.id: i for i, ep in enumerate(ctx.episodes)}
    seen = set()
    for quote in quotes:
        resolved = _resolve_quote(quote, ctx.episodes_by_id, positions)
        if resolved is None:
            continue
        key = (resolved.speaker, resolved.episode_id, resolved.marker_id, resolved.msg_idx,
               resolved.start, resolved.end)
        if key in seen:
            continue
        seen.add(key)
        ctx.quotes_by_marker.setdefault((resolved.speaker, resolved.marker_id), []).append(resolved)
    for bucket in ctx.quotes_by_marker.values():
        bucket.sort(key=lambda q: (q.pos, q.msg_idx, q.start, q.end))


def _resolve_quote(quote: ExpQuote, episodes_by_id: Dict[str, Episode], positions: Dict[str, int],
                   ) -> Optional[_ResolvedQuote]:
    episode = episodes_by_id.get(quote.episode_id)
    if episode is None:
        return None
    msgs = episode.msgs
    if quote.msg_idx < 0 or quote.msg_idx >= len(msgs):
        return None
    msg = msgs[quote.msg_idx]
    if msg.speaker != quote.speaker:
        return None
    text = msg.text
    start, end = int(quote.start), int(quote.end)
    if start < 0 or end > len(text) or start >= end:
        return None
    span = text[start:end]
    if not span:
        return None
    ts = msg.ts
    if ts.tzinfo is None:
        from datetime import timezone
        ts = ts.replace(tzinfo=timezone.utc)
    return _ResolvedQuote(
        speaker=quote.speaker, episode_id=quote.episode_id, marker_id=quote.marker_id, text=span,
        ts=ts.isoformat(), msg_idx=quote.msg_idx, start=start, end=end,
        pos=positions.get(quote.episode_id, 10 ** 9),
    )


def _pooled(ctx: _Ctx, speaker: str, marker_id: str, *, week: Optional[str] = None,
            draws: Optional[Sequence[str]] = None) -> Optional[Tuple[float, float]]:
    episodes = ctx.cells.get((speaker, marker_id))
    if not episodes:
        return None
    num = 0.0
    den = 0.0
    if draws is None:
        for cell in episodes.values():
            if week is not None and cell.week != week:
                continue
            num += cell.num
            den += cell.den
    else:
        for episode_id in draws:
            cell = episodes.get(episode_id)
            if cell is None:
                continue
            if week is not None and cell.week != week:
                continue
            num += cell.num
            den += cell.den
    if den <= 0.0:
        return None
    return num, den


def _holistic_value(ctx: _Ctx, speaker: str, dimension: str) -> Optional[float]:
    if not ctx.llm_ran or ctx.llm is None:
        return None
    per = ctx.llm.holistic.get(speaker) if ctx.llm.holistic else None
    if not per:
        return None
    raw = per.get(dimension, None)
    if raw is None or not _finite(raw):
        return None
    return float(raw)


def _marker_value(ctx: _Ctx, marker: Marker, speaker: str, *, week: Optional[str] = None,
                  draws: Optional[Sequence[str]] = None, include_holistic: bool = True,
                  ) -> Tuple[str, Optional[float]]:
    """Return ``(status, value)``. Status is ok, not_run, or no_data."""
    if marker.source == "holistic":
        if not include_holistic:
            return "no_data", None
        if not ctx.llm_ran or ctx.llm is None:
            return "not_run", None
        value = _holistic_value(ctx, speaker, marker.dimension)
        if value is None:
            return "no_data", None
        return "ok", value
    if marker.source == "llm":
        if not ctx.llm_ran or ctx.llm is None:
            return "not_run", None
        if marker.id[4:] in ctx.unstable.get(speaker, ()):
            return "no_data", None
    elif marker.id in (ctx.det.unavailable or {}):
        return "not_run", None
    pooled = _pooled(ctx, speaker, marker.id, week=week, draws=draws)
    if pooled is None:
        return "no_data", None
    return "ok", _to_value(pooled[0], pooled[1], marker.unit)


def _values_for(ctx: _Ctx, markers: Sequence[Marker], speaker: str, *, week: Optional[str] = None,
                draws: Optional[Sequence[str]] = None, include_holistic: bool = True) -> Dict[str, float]:
    values: Dict[str, float] = {}
    for marker in markers:
        status, value = _marker_value(
            ctx, marker, speaker, week=week, draws=draws, include_holistic=include_holistic)
        if status == "ok" and value is not None:
            values[marker.id] = value
    return values


def _episode_words(episode: Episode, speaker: str) -> int:
    if speaker in episode.word_counts:
        return int(episode.word_counts[speaker])
    return sum(len(tokenize(msg.text)) for msg in episode.msgs if msg.speaker == speaker)


def _gate_counts(ctx: _Ctx, speaker: str) -> Tuple[int, int]:
    words = ctx.det.words.get(speaker, 0) if ctx.det.words else 0
    n_words = int(words or 0)
    if ctx.llm_ran:
        agreeing = ctx.llm.agreeing_episodes if ctx.llm is not None else {}
        n_eps = int((agreeing or {}).get(speaker, 0) or 0)
    else:
        counts = ctx.det.episodes_with_speaker or {}
        n_eps = int(counts.get(speaker, 0) or 0)
    return n_eps, n_words


def _confidence(ctx: _Ctx, dim, speaker: str, n_episodes: int, n_words: int) -> str:
    agreement = None
    if ctx.llm_ran and ctx.llm is not None and ctx.llm.agreement_rate:
        agreement = ctx.llm.agreement_rate.get(speaker)
    medium = (
        dim.max_confidence == "medium"
        and dim.evidence_strength == "moderate"
        and n_episodes >= EXP_MEDIUM_EPISODES
        and n_words >= EXP_MEDIUM_WORDS
        and agreement is not None
        and float(agreement) >= EXP_MEDIUM_AGREEMENT
    )
    return "medium" if medium else "low"


def _episode_population(ctx: _Ctx, markers: Sequence[Marker], speaker: str) -> List[str]:
    have = set()
    for marker in markers:
        if marker.source == "holistic":
            continue
        for episode_id in ctx.cells.get((speaker, marker.id), {}):
            have.add(episode_id)
    positions = {ep.id: i for i, ep in enumerate(ctx.episodes)}
    known = sorted((eid for eid in have if eid in positions), key=lambda eid: positions[eid])
    unknown = sorted(eid for eid in have if eid not in positions)
    return known + unknown


def _bootstrap_samples(ctx: _Ctx, dim, markers: Sequence[Marker], speaker: str, point: int) -> List[int]:
    population = _episode_population(ctx, markers, speaker)
    n = len(population)
    if n == 0:
        return [point]
    rng = _bootstrap_rng(ctx.seed, speaker, dim.key)
    samples: List[int] = []
    for _ in range(EXP_BOOTSTRAP):
        draws = [population[rng.randrange(n)] for _ in range(n)]
        values = _values_for(ctx, markers, speaker, draws=draws, include_holistic=True)
        score, _shares, _subs = _score_from_values(markers, values, ctx.anchors)
        if score is not None:
            samples.append(score)
    if len(samples) < 2:
        return [point]
    return samples


def _band(ctx: _Ctx, dim, markers: Sequence[Marker], speaker: str, point: int) -> dict:
    samples = _bootstrap_samples(ctx, dim, markers, speaker, point)
    p_lo = _percentile(samples, EXP_BAND_LO_PCT / 100.0)
    p_hi = _percentile(samples, EXP_BAND_HI_PCT / 100.0)
    penalty = _evidence_penalty(dim.evidence_strength, ctx.llm_ran)
    lo = _clamp_int(p_lo - penalty)
    hi = _clamp_int(p_hi + penalty)
    if lo > hi:
        lo, hi = hi, lo
    return {"lo": lo, "hi": hi}


def _present_weeks(ctx: _Ctx, speaker: str) -> List[str]:
    present = set()
    for episode in ctx.episodes:
        if _episode_words(episode, speaker) > 0:
            present.add(week_key(episode))
    for (sp, _mid), episodes in ctx.cells.items():
        if sp != speaker:
            continue
        for cell in episodes.values():
            if _WEEK_RE.match(cell.week):
                present.add(cell.week)
    ordered: List[str] = []
    seen = set()
    for week in ctx.week_order:
        if week in present and week not in seen and _WEEK_RE.match(week):
            ordered.append(week)
            seen.add(week)
    for week in sorted(present):
        if week not in seen:
            ordered.append(week)
            seen.add(week)
    return ordered


def _trend(ctx: _Ctx, dim, markers: Sequence[Marker], speaker: str) -> List[dict]:
    points: List[dict] = []
    obs_ids_by_week: Dict[str, set] = {}
    for marker in markers:
        if marker.source == "holistic":
            continue
        for episode_id, cell in ctx.cells.get((speaker, marker.id), {}).items():
            obs_ids_by_week.setdefault(cell.week, set()).add(episode_id)
    for week in _present_weeks(ctx, speaker):
        seen = set()
        chosen: List[Episode] = []
        for episode in ctx.episodes:
            if week_key(episode) != week or episode.id in seen:
                continue
            has_words = _episode_words(episode, speaker) > 0
            has_obs = episode.id in obs_ids_by_week.get(week, ())
            if not has_words and not has_obs:
                continue
            seen.add(episode.id)
            chosen.append(episode)
        n_episodes = len(chosen)
        n_words = sum(_episode_words(episode, speaker) for episode in chosen)
        if n_words < EXP_TREND_MIN_WORDS or n_episodes < EXP_TREND_MIN_EPISODES:
            points.append({
                "week": week, "score": None, "n_episodes": n_episodes, "n_words": n_words,
                "reason": strings.REASON_TREND_THIN_WEEK,
            })
            continue
        values = _values_for(ctx, markers, speaker, week=week, include_holistic=False)
        score, _shares, _subs = _score_from_values(markers, values, ctx.anchors)
        if score is None:
            points.append({
                "week": week, "score": None, "n_episodes": n_episodes, "n_words": n_words,
                "reason": strings.REASON_TOO_FEW_MARKERS,
            })
        else:
            points.append({
                "week": week, "score": score, "n_episodes": n_episodes, "n_words": n_words, "reason": None,
            })
    return points


def _assign_quote_ids(ctx: _Ctx, speaker: str, marker_id: str) -> List[str]:
    bucket = ctx.quotes_by_marker.get((speaker, marker_id), ())
    ids: List[str] = []
    for quote in bucket:
        if len(ids) >= EXP_MAX_QUOTES_PER_CONTRIBUTION:
            break
        key = (quote.speaker, quote.episode_id, quote.marker_id, quote.msg_idx, quote.start, quote.end)
        qid = ctx.quote_ids.get(key)
        if qid is None:
            qid = f"xq_{ctx.quote_n:03d}"
            ctx.quote_n += 1
            ctx.quote_ids[key] = qid
            ctx.quotes_out.append({
                "id": qid,
                "speaker": quote.speaker,
                "episode_id": quote.episode_id,
                "marker_key": quote.marker_id,
                "text": quote.text,
                "ts": quote.ts,
            })
        ids.append(qid)
    return ids


def _contribution(marker: Marker, anchor_source: str, *, status: str, weight: float,
                  value: Optional[float], sub_score: Optional[float], quote_ids: List[str]) -> dict:
    return {
        "marker_key": marker.id,
        "label": marker.label,
        "source": SOURCE_CODES[marker.source],
        "direction": DIRECTION_CODES[marker.direction],
        "weight": weight,
        "value": None if value is None else _r3(value),
        "unit": marker.unit,
        "sub_score": None if sub_score is None else _r3_unit(sub_score),
        "anchor_source": anchor_source,
        "status": status,
        "quote_ids": list(quote_ids),
    }


def _speaker_block(ctx: _Ctx, dim, markers: Sequence[Marker], speaker: str) -> dict:
    statuses: Dict[str, str] = {}
    raw_values: Dict[str, float] = {}
    for marker in markers:
        status, value = _marker_value(ctx, marker, speaker, include_holistic=True)
        statuses[marker.id] = status
        if status == "ok" and value is not None:
            raw_values[marker.id] = value
    point, shares, subs = _score_from_values(markers, raw_values, ctx.anchors)
    displayed = _display_weights(shares)
    order = {marker.id: i for i, marker in enumerate(markers)}
    contributions: List[dict] = []
    for marker in markers:
        status = statuses[marker.id]
        anchor_source = str(ctx.anchors[marker.id]["anchor_source"])
        if status == "ok":
            quote_ids = _assign_quote_ids(ctx, speaker, marker.id)
            contributions.append(_contribution(
                marker, anchor_source, status="ok", weight=displayed.get(marker.id, 0.0),
                value=raw_values[marker.id], sub_score=subs[marker.id], quote_ids=quote_ids,
            ))
        else:
            contributions.append(_contribution(
                marker, anchor_source, status=status, weight=0.0, value=None, sub_score=None, quote_ids=[],
            ))
    contributions.sort(key=lambda row: (-round(float(shares.get(row["marker_key"], 0.0)), 6),
                                        order[row["marker_key"]]))
    quote_ids: List[str] = []
    seen_quotes = set()
    for row in contributions:
        for qid in row["quote_ids"]:
            if qid not in seen_quotes:
                seen_quotes.add(qid)
                quote_ids.append(qid)
    n_episodes, n_words = _gate_counts(ctx, speaker)
    if n_episodes < EXP_MIN_EPISODES:
        status, reason, score, band, confidence = (
            "insufficient_data", strings.REASON_TOO_FEW_EPISODES, None, None, None)
    elif n_words < EXP_MIN_WORDS:
        status, reason, score, band, confidence = (
            "insufficient_data", strings.REASON_TOO_FEW_WORDS, None, None, None)
    elif point is None:
        status, reason, score, band, confidence = (
            "insufficient_data", strings.REASON_TOO_FEW_MARKERS, None, None, None)
    else:
        status, reason = "ok", None
        score = point
        band = _band(ctx, dim, markers, speaker, point)
        confidence = _confidence(ctx, dim, speaker, n_episodes, n_words)
    return {
        "status": status,
        "reason": reason,
        "score": score,
        "band": band,
        "confidence": confidence,
        "n_episodes": n_episodes,
        "n_words": n_words,
        "contributions": contributions,
        "trend": _trend(ctx, dim, markers, speaker),
        "quote_ids": quote_ids,
    }


def _not_run_speaker(reason: str, markers: Sequence[Marker], anchors: Dict[str, dict]) -> dict:
    contributions = []
    for marker in markers:
        contributions.append(_contribution(
            marker, str(anchors[marker.id]["anchor_source"]), status="not_run", weight=0.0,
            value=None, sub_score=None, quote_ids=[],
        ))
    return {
        "status": "not_run",
        "reason": reason,
        "score": None,
        "band": None,
        "confidence": None,
        "n_episodes": 0,
        "n_words": 0,
        "contributions": contributions,
        "trend": [],
        "quote_ids": [],
    }


def _section_status(rows: Sequence[Tuple[str, Optional[str]]]) -> Tuple[str, Optional[str]]:
    if any(status == "ok" for status, _reason in rows):
        return "ok", None
    for status, reason in rows:
        if status == "insufficient_data":
            return "insufficient_data", reason
    for status, reason in rows:
        if status == "not_run":
            return "not_run", reason
    return "ok", None


def _speakers_scored(score_other: bool) -> List[str]:
    if score_other:
        return ["me", "other"]
    return ["me"]


def _shell(status: str, reason: Optional[str], speakers_scored: List[str], dimensions: List[dict],
           quotes: List[dict]) -> dict:
    return {
        "status": status,
        "reason": reason,
        "banner": strings.BANNER,
        "title": strings.TITLE,
        "scale_note": strings.SCALE_NOTE,
        "footer_support": strings.FOOTER_SUPPORT,
        "how_it_works": strings.HOW_IT_WORKS,
        "scoring_version": EXP_SCORING_VERSION,
        "prompt_versions": {"episode": EXP_PROMPT_VERSION, "holistic": EXP_HOLISTIC_PROMPT_VERSION},
        "anchors_version": EXP_ANCHORS_VERSION,
        "speakers_scored": speakers_scored,
        "thresholds": {
            "min_episodes": EXP_MIN_EPISODES,
            "min_words": EXP_MIN_WORDS,
            "max_confidence": EXP_MAX_CONFIDENCE,
        },
        "dimensions": dimensions,
        "quotes": quotes,
    }
