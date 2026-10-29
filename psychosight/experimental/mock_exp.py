"""Deterministic offline completions for the experimental prompts.

``MockProvider`` routes system prompts that start with ``TASK: EXPERIMENTAL`` or ``TASK: HOLISTIC``
here. Scores come from marker words in the rated speaker's lines, quotes are verbatim slices of
those lines, and one item (plus one holistic domain) disagrees across runs on a hash of the text
so the stability rule has something to drop.

No network, no randomness, and nothing here is logged.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Dict, List, Optional, Sequence, Tuple

from ..llm import LLMResult
from ..rubric import DATA_CLOSE, DATA_OPEN
from .contract import BIG_FIVE, PROMPT_PREFIX_HOLISTIC
from .llm_exp import items_for_speaker

# Run 1 moves these by at least 2 points when the text hash falls in the bucket.
DISAGREE_ITEM = "deflects_closeness"
DISAGREE_DOMAIN = "openness"

_LINE = re.compile(r"^\[(\d+)\] (ME|OTHER): (.*)$")
_SPEAKERS = re.compile(r"^Speakers to rate:\s*(.*)$", re.M)
_ONE_SPEAKER = re.compile(r"^Speaker to rate:\s*(me|other)\b", re.M)
_ITEMS_FOR = re.compile(r"^Items for (me|other):\s*$", re.M)

# Single words are matched on boundaries so "hell" does not fire inside "hello".
# Phrases are matched as substrings. Planted worry / negative wording should raise the
# worry items and neuroticism; planted anger / swear wording should raise escalating
# wording and blame, and lower agreeableness.
_WORRY = (
    "worried", "worry", "worrying", "worries", "nervous", "scared", "afraid", "stressed", "stress", "fear", "anxious",
)
_NEGATIVE = (
    "hopeless", "pointless", "exhausted", "miserable", "empty", "depressed", "sad", "no energy", "can't get up",
    "no point", "worn out",
)
_ANGER = (
    "shit", "fuck", "damn", "hell", "asshole", "bastard", "crap", "bitch", "angry", "furious", "hate", "shut up",
    "so sick of",
)
_BLAME = ("you never", "your fault", "you always", "you're the one", "you did this", "because of you")
_OPEN = ("idea", "ideas", "novel", "curious", "imagine", "imagination", "art", "poem", "philosophy", "wonder")
_PLAN = ("finished", "schedule", "planned", "on time", "i completed", "followed through", "got it done", "i finished",
         "i did it")
_SOCIAL = ("friends", "party", "hang out", "come over", "let's hang", "so excited")

_CUES: Dict[str, Tuple[str, ...]] = {
    "follows_through_on_plans": ("i finished", "i did it", "as i said i would", "followed through", "got it done",
                                 "i completed"),
    "expressed_worry": _WORRY,
    "reassurance_seeking": ("are you mad", "do you still", "are we ok", "are we okay", "please tell me",
                            "need you to say", "do you love"),
    "hopeless_or_low_energy_wording": _NEGATIVE,
    "negative_self_evaluation": ("i'm terrible", "i am terrible", "i'm a mess", "i hate myself", "i'm useless",
                                 "i failed", "my fault", "i'm worthless", "i suck"),
    "urge_or_loss_of_control_wording": ("can't stop", "cannot stop", "one more", "lost control", "the urge",
                                        "craving", "couldn't stop"),
    "using_to_cope_wording": ("to cope", "to calm down", "need a drink", "had a drink", "take the edge off",
                              "so i can sleep"),
    "superiority_or_entitlement_phrasing": ("i deserve", "i'm better", "you owe me", "better than you", "i'm the best"),
    "worry_about_the_relationship": ("lose you", "falling apart", "about us", "leave me", "are we ok", "are we okay"),
    "emotional_disclosure": ("i feel", "i'm scared", "i am sad", "i'm hurt", "i'm sad", "honestly i"),
    "deflects_closeness": ("i'm fine", "don't want to talk", "change the subject", "rather not say", "drop it",
                           "not a big deal"),
    "validates_feelings": ("sounds hard", "i'm sorry you", "that makes sense", "i hear you", "that sucks", "i get why"),
    "assigns_fault_to_other": _BLAME,
    "escalating_language": _ANGER,
    "repair_attempts": ("i'm sorry", "i apologize", "let's talk", "can we start over", "my bad"),
    "topic_redirect_to_self": ("enough about you", "anyway i", "speaking of me", "back to my", "enough about that"),
}

_HOLISTIC_CUES: Dict[str, Tuple[str, ...]] = {
    "openness": _OPEN,
    "conscientiousness": _PLAN,
    "extraversion": _SOCIAL,
    "agreeableness": _ANGER,  # more hits → lower rating
    "neuroticism": _WORRY + _NEGATIVE,
}


def _norm(text: str) -> str:
    return text.lower().replace("\u2019", "'").replace("\u2018", "'")


def _cue_in(low: str, cue: str) -> bool:
    if " " in cue or "'" in cue:
        return cue in low
    return re.search(r"(?<![a-z0-9'])" + re.escape(cue) + r"(?![a-z0-9'])", low) is not None


def _hits(text: str, cues: Sequence[str]) -> List[str]:
    low = _norm(text)
    return [cue for cue in cues if _cue_in(low, cue)]


def _bucket(text: str, key: str) -> int:
    return int(hashlib.sha256(f"{key}\n{text}".encode("utf-8")).hexdigest()[:8], 16)


def _block(user: str) -> str:
    start, end = user.find(DATA_OPEN), user.rfind(DATA_CLOSE)
    if start < 0 or end <= start:
        return ""
    return user[start + len(DATA_OPEN):end]


def _parse_lines(user: str) -> Tuple[Dict[str, List[str]], str]:
    groups: Dict[str, List[str]] = {"me": [], "other": []}
    block = _block(user)
    for raw in block.splitlines():
        match = _LINE.match(raw)
        if not match:
            continue
        speaker = "me" if match.group(2) == "ME" else "other"
        groups[speaker].append(match.group(3))
    return groups, block


def _speakers(system: str, user: str) -> Tuple[str, ...]:
    match = _SPEAKERS.search(user)
    if match:
        found = []
        for part in match.group(1).split(","):
            name = part.strip().lower().rstrip(".")
            if name in ("me", "other") and name not in found:
                found.append(name)
        if found:
            return tuple(name for name in ("me", "other") if name in found)
    found = [m.group(1) for m in _ITEMS_FOR.finditer(system)]
    ordered = tuple(name for name in ("me", "other") if name in found)
    return ordered or ("me",)


def _quote(lines: Sequence[str], cue: Optional[str]) -> Optional[str]:
    chosen = None
    if cue:
        for line in lines:
            if _cue_in(_norm(line), cue):
                chosen = line
                break
    if chosen is None and lines:
        chosen = lines[0]
    if not chosen:
        return None
    text = chosen.strip()
    if len(text) < 3:
        return None
    if len(text) <= 240:
        return text
    if cue:
        low = _norm(text)
        pos = low.find(_norm(cue))
        if pos >= 0:
            start = max(0, pos - 40)
            end = min(len(text), pos + len(cue) + 160)
            snippet = text[start:end].strip()
            if len(snippet) >= 3:
                return snippet[:240]
    return text[:240]


def _item_score(item: str, lines: Sequence[str], run_idx: int, block: str) -> dict:
    if not lines:
        return {"score": None, "quote": None}
    found = _hits("\n".join(lines), _CUES.get(item, ()))
    if not found:
        score, quote = 1, None
    else:
        score = 5 if len(found) >= 2 else 4
        quote = _quote(lines, found[0])
    if run_idx == 1 and item == DISAGREE_ITEM and _bucket(block, item) % 4 == 0:
        score = 1 if score >= 4 else 5
        quote = None if score == 1 else (quote or _quote(lines, None))
    return {"score": score, "quote": quote}


def _episode(system: str, user: str, run_idx: int) -> dict:
    groups, block = _parse_lines(user)
    out = {}
    for name in _speakers(system, user):
        out[name] = {key: _item_score(key, groups[name], run_idx, block) for key in items_for_speaker(name)}
    return out


def _domain_score(domain: str, text: str, run_idx: int, block: str):
    if not text.strip():
        return None
    found = _hits(text, _HOLISTIC_CUES.get(domain, ()))
    if domain == "agreeableness":
        score = 1 if len(found) >= 2 else (2 if found else 4)
    else:
        score = 5 if len(found) >= 2 else (4 if found else 2)
    if run_idx == 1 and domain == DISAGREE_DOMAIN and _bucket(block, domain) % 5 == 0:
        score = 1 if score >= 4 else 5
    return score


def _holistic(user: str, run_idx: int) -> dict:
    groups, block = _parse_lines(user)
    match = _ONE_SPEAKER.search(user)
    speaker = match.group(1) if match else "me"
    text = "\n".join(groups.get(speaker, ()))
    return {key: {"score": _domain_score(key, text, run_idx, block)} for key in BIG_FIVE}


def complete(system: str, user: str, run_idx: int = 0) -> LLMResult:
    """Deterministic JSON for one experimental or holistic prompt. ``run_idx`` selects the flip bucket."""
    if (system or "").startswith(PROMPT_PREFIX_HOLISTIC):
        payload = _holistic(user, run_idx)
    else:
        payload = _episode(system or "", user or "", run_idx)
    return LLMResult(content=json.dumps(payload))
