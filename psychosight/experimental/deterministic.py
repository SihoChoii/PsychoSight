"""Deterministic language markers (word lists, VADER valence, WWBP sums).

``compute_deterministic`` returns one ``MarkerObservation`` per available D marker, speaker, and
episode. Track C pools ``sum(num) / sum(den)``.

- Word rates: num = matching tokens, den = words. Reported times 100 as "% of words".
- ``wwbp.*``: num = ``100 * sum(weight * n-gram count)``, den = words, so the pooled value is
  lexicon units per 100 words. N-grams may overlap; each published term contributes its own weight.
- ``vader_compound``: num = sum of per-message compounds, den = messages.
- ``initiation_share``: num = 1 when this speaker opened the episode, else 0; den = 1.
- ``late_night_episode_share``: num = 1 when this speaker opened the episode and
  ``features.is_late_night`` is true (01:00 inclusive through 04:00 exclusive, local time), else 0;
  den = 1.
- ``double_text_rate``: num = the features.py follow-up-turn count (a turn whose speaker also spoke
  the previous turn); den = this speaker's messages. Reported times 100 as "% of messages".

Substance and gambling terms count only when an I/me/my token (the same set as ``features.count_i``)
falls within 5 tokens in the same message. Week strings are ``features.week_key`` (ISO week of the
episode start, local time).
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

from ..features import count_absolutist, count_i, count_we, is_late_night, tokenize, week_key
from ..models import Episode
from .contract import DeterministicResult, MarkerObservation, deterministic_marker_ids
from .lexicons import (
    count_first_person, count_long_words, count_terms, load_wwbp, marker_terms, message_compound,
)
from .strings import REASON_WWBP_MISSING

# marker id -> key in marker_terms(), for rates whose denominator is the word count.
_WORD_MARKERS = {
    "long_word_share": None,
    "empath_intellect": "empath_intellect",
    "swear_rate": "swear",
    "pos_emotion_rate": "pos_emotion",
    "social_word_rate": "social",
    "anger_swear_rate": "anger_swear",
    "neg_emotion_rate": "neg_emotion",
    "anxiety_word_rate": "anxiety",
    "tentative_worry_rate": "tentative_worry",
    "craving_phrase_rate": "craving",
    "anger_rage_rate": "anger_rage",
    "achievement_work_rate": "achievement_work",
    "you_rate": "you",
    "tentative_anxiety_rate": "tentative_anxiety",
}
_FIRST_PERSON_MARKERS = {
    "substance_first_person_rate": "substance",
    "gambling_first_person_rate": "gambling",
}


def _dedupe(speakers: Sequence[str]) -> Tuple[str, ...]:
    seen = []
    for speaker in speakers:
        if speaker not in seen:
            seen.append(speaker)
    return tuple(seen)


def _wwbp_unavailable(loaded) -> Dict[str, str]:
    unavailable = {}
    for marker_id in deterministic_marker_ids():
        if not marker_id.startswith("wwbp."):
            continue
        trait = marker_id.split(".", 1)[1]
        if loaded is None or trait not in loaded:
            unavailable[marker_id] = REASON_WWBP_MISSING
    return unavailable


def _message_tokens(episode: Episode, speaker: str) -> List[List[str]]:
    return [tokenize(msg.text) for msg in episode.msgs if msg.speaker == speaker]


def _double_text_turns(episode: Episode, speaker: str) -> int:
    """Follow-up turns by ``speaker``: the previous turn in the episode has the same speaker.

    This is the features.py double-text count. Messages inside one turn are not follow-ups;
    turns are already split on the turn gap.
    """
    count = 0
    prev = None
    for turn in episode.turns:
        if prev is not None and prev.speaker == turn.speaker and turn.speaker == speaker:
            count += 1
        prev = turn
    return count


def _word_num(marker_id: str, messages: Sequence[Sequence[str]], terms, wwbp) -> Optional[float]:
    """Numerator for a word-denominator marker, or None when this id is not one of those."""
    if marker_id in _WORD_MARKERS:
        total = 0
        kind = _WORD_MARKERS[marker_id]
        for tokens in messages:
            if marker_id == "long_word_share":
                total += count_long_words(tokens)
            else:
                total += count_terms(tokens, terms[kind])
        return float(total)
    if marker_id in _FIRST_PERSON_MARKERS:
        vocab = terms[_FIRST_PERSON_MARKERS[marker_id]].unigrams
        return float(sum(count_first_person(tokens, vocab) for tokens in messages))
    if marker_id == "i_rate":
        return float(sum(count_i(tokens) for tokens in messages))
    if marker_id == "we_rate":
        return float(sum(count_we(tokens) for tokens in messages))
    if marker_id == "absolutist_rate":
        return float(sum(count_absolutist(tokens) for tokens in messages))
    if marker_id.startswith("wwbp."):
        trait = marker_id.split(".", 1)[1]
        lexicon = None if wwbp is None else wwbp.get(trait)
        if lexicon is None:
            return None
        return float(100.0 * sum(lexicon.sum(tokens) for tokens in messages))
    return None


def compute_deterministic(episodes: List[Episode], speakers: Sequence[str]) -> DeterministicResult:
    """One observation per available D marker x speaker x episode.

    Every deterministic marker id in ``MARKERS`` is either present in ``observations`` (when
    ``episodes`` is non-empty) or listed in ``unavailable``. Missing WWBP data does not raise.
    """
    wanted = _dedupe(speakers)
    wwbp = load_wwbp()
    unavailable = _wwbp_unavailable(wwbp)
    terms = marker_terms()
    marker_ids = tuple(mid for mid in deterministic_marker_ids() if mid not in unavailable)

    words = {speaker: 0 for speaker in wanted}
    episodes_with_speaker = {speaker: 0 for speaker in wanted}
    observations: List[MarkerObservation] = []

    for episode in episodes:
        week = week_key(episode)
        opened_by = episode.initiator
        late = is_late_night(episode)
        per_speaker = {speaker: _message_tokens(episode, speaker) for speaker in wanted}
        for speaker in wanted:
            messages = per_speaker[speaker]
            n_messages = len(messages)
            n_words = sum(len(tokens) for tokens in messages)
            words[speaker] += n_words
            if n_messages >= 1:
                episodes_with_speaker[speaker] += 1
            doubles = _double_text_turns(episode, speaker)
            for marker_id in marker_ids:
                word_num = _word_num(marker_id, messages, terms, wwbp)
                if word_num is not None:
                    num, den = word_num, float(n_words)
                elif marker_id == "vader_compound":
                    num = float(sum(message_compound(tokens) for tokens in messages))
                    den = float(n_messages)
                elif marker_id == "initiation_share":
                    num = 1.0 if opened_by == speaker else 0.0
                    den = 1.0
                elif marker_id == "late_night_episode_share":
                    num = 1.0 if opened_by == speaker and late else 0.0
                    den = 1.0
                elif marker_id == "double_text_rate":
                    num = float(doubles)
                    den = float(n_messages)
                else:
                    # A new D marker was added to the frozen registry without a counter.
                    raise KeyError(marker_id)
                observations.append(MarkerObservation(marker_id, speaker, episode.id, num, den, week))

    return DeterministicResult(observations, words, episodes_with_speaker, unavailable)
