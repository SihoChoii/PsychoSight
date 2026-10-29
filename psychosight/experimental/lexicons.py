"""Word lists and lexicon matchers for the experimental deterministic markers.

Own lists (MIT) live in ``data/wordlists/``. VADER and an Empath category subset
(both MIT) live in ``data/third_party/``. The WWBP Big Five lexicon (CC BY-NC-SA
3.0, non-commercial / hackathon-only) lives in the removable ``wwbp/`` directory.
Tokenization is ``features.tokenize`` so counts match the main report.

WWBP is optional. If that directory or its JSON is missing or unreadable,
``load_wwbp`` returns None and the caller lists ``wwbp.*`` as unavailable.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, FrozenSet, Iterable, List, Optional, Sequence, Tuple

from ..features import I_PREFIX, I_WORDS, tokenize
from .contract import BIG_FIVE

_PKG = Path(__file__).resolve().parent
DATA_DIR = _PKG / "data"
WORDLIST_DIR = DATA_DIR / "wordlists"
THIRD_PARTY_DIR = DATA_DIR / "third_party"
# Patched in tests. ``load_wwbp`` reads this at call time, not at import.
WWBP_DIR = _PKG / "wwbp"
WWBP_JSON_NAME = "bigfive_lexicon.json"

FIRST_PERSON_WINDOW = 5
NEGATION_WINDOW = 3
# VADER's empirically derived negation scalar (Hutto & Gilbert 2014).
N_SCALAR = -0.74
VADER_ALPHA = 15.0
LONG_WORD_LETTERS = 7

WORD_LISTS: Tuple[str, ...] = (
    "tentative", "worry", "anxiety", "negative_emotion", "positive_emotion", "social", "anger", "rage",
    "swear", "achievement_work", "you", "substance", "gambling", "craving", "intellect",
)

# Empath categories vendored in empath_subset.tsv, upstream order.
EMPATH_CATEGORY_NAMES: Tuple[str, ...] = (
    "negative_emotion", "sadness", "nervousness", "anger", "rage", "swearing_terms", "alcohol",
    "achievement", "work", "sports", "positive_emotion", "affection", "friends", "family", "art",
    "reading", "philosophy",
)

# High-frequency Empath tokens that are not the topic of their category. The TSV is unchanged;
# these are skipped only when a category is counted toward a marker. "friend" is skipped here
# and still counted, because our own social list includes it.
EMPATH_COUNT_SKIP = frozenset({
    "thinking", "stop", "either", "mean", "hard", "reason", "wanted", "care", "seeing", "break",
    "alone", "lie", "lost", "lose", "hit", "beat", "sick", "wrong", "react", "always", "bad",
    "happiness", "innocence", "sympathy", "empathy", "emotion", "feeling", "cope", "concern",
    "overcome", "depth", "evident", "loose", "bull", "mad", "rude", "nasty", "disrespectful",
    "screwed", "moron", "home", "friend",
})

# VADER negation list (Hutto & Gilbert), plus "no", which their scorer treats as negation when
# it precedes a lexicon word. Matching uses our tokens, so both "don't" and "dont" are listed.
NEGATE = frozenset({
    "aint", "arent", "cannot", "cant", "couldnt", "darent", "didnt", "doesnt",
    "ain't", "aren't", "can't", "couldn't", "daren't", "didn't", "doesn't",
    "dont", "hadnt", "hasnt", "havent", "isnt", "mightnt", "mustnt", "neither",
    "don't", "hadn't", "hasn't", "haven't", "isn't", "mightn't", "mustn't",
    "neednt", "needn't", "never", "none", "nope", "nor", "not", "nothing", "nowhere",
    "oughtnt", "shant", "shouldnt", "uhuh", "wasnt", "werent",
    "oughtn't", "shan't", "shouldn't", "uh-uh", "wasn't", "weren't",
    "without", "wont", "wouldnt", "won't", "wouldn't", "rarely", "seldom", "despite",
    "no",
})

_TRAIT_BY_KEY = {
    "o": "openness", "c": "conscientiousness", "e": "extraversion", "a": "agreeableness", "n": "neuroticism",
    "openness": "openness", "conscientiousness": "conscientiousness", "extraversion": "extraversion",
    "agreeableness": "agreeableness", "neuroticism": "neuroticism",
}


@dataclass(frozen=True)
class TermList:
    """Unigrams plus multi-word phrases. Phrases are token tuples from ``features.tokenize``."""

    unigrams: FrozenSet[str]
    phrases: Tuple[Tuple[str, ...], ...]


class WeightedLexicon:
    """N-gram -> weight. ``sum`` adds every matching n-gram, including overlaps."""

    def __init__(self, scores: Dict[Tuple[str, ...], float]):
        self.scores = scores
        by_len: Dict[int, Dict[Tuple[str, ...], float]] = {}
        for gram, weight in scores.items():
            by_len.setdefault(len(gram), {})[gram] = weight
        self.by_len = by_len

    def weight(self, gram: Tuple[str, ...]) -> Optional[float]:
        return self.scores.get(gram)

    def sum(self, tokens: Sequence[str]) -> float:
        if not tokens or not self.by_len:
            return 0.0
        total = 0.0
        n = len(tokens)
        for length, grams in self.by_len.items():
            if length > n:
                continue
            for i in range(n - length + 1):
                weight = grams.get(tuple(tokens[i:i + length]))
                if weight is not None:
                    total += weight
        return total


@dataclass(frozen=True)
class VaderLexicon:
    scores: Dict[Tuple[str, ...], float]
    lengths: Tuple[int, ...]
    unigrams: FrozenSet[str]


def _read_required(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError("required lexicon file missing: {0}".format(path))
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=None)
def load_terms(name: str) -> TermList:
    """Load ``data/wordlists/<name>.txt``. Blank lines and ``#`` comments are ignored."""
    if name not in WORD_LISTS:
        raise KeyError(name)
    unigrams = set()
    phrases: List[Tuple[str, ...]] = []
    seen_phrases = set()
    text = _read_required(WORDLIST_DIR / "{0}.txt".format(name))
    for raw in text.splitlines():
        line = raw.strip().lower()
        if not line or line.startswith("#"):
            continue
        toks = tuple(tokenize(line))
        if not toks:
            continue
        if len(toks) == 1:
            unigrams.add(toks[0])
        elif toks not in seen_phrases:
            seen_phrases.add(toks)
            phrases.append(toks)
    return TermList(frozenset(unigrams), tuple(phrases))


def union_terms(*lists: TermList) -> TermList:
    unigrams = set()
    phrases: List[Tuple[str, ...]] = []
    seen = set()
    for term_list in lists:
        unigrams.update(term_list.unigrams)
        for phrase in term_list.phrases:
            if phrase not in seen:
                seen.add(phrase)
                phrases.append(phrase)
    return TermList(frozenset(unigrams), tuple(phrases))


@lru_cache(maxsize=1)
def empath_categories() -> Dict[str, FrozenSet[str]]:
    """Raw Empath subset: category -> words as published (lowercased). Includes skipped tokens."""
    found: Dict[str, FrozenSet[str]] = {}
    for line in _read_required(THIRD_PARTY_DIR / "empath_subset.tsv").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        words = frozenset(w.strip().lower() for w in parts[1:] if w.strip())
        found[parts[0].strip()] = words
    missing = [name for name in EMPATH_CATEGORY_NAMES if name not in found]
    if missing:
        raise FileNotFoundError("empath subset missing categories: {0}".format(", ".join(missing)))
    return found


def empath_unigrams(name: str) -> FrozenSet[str]:
    """Category words that tokenize to one token, minus ``EMPATH_COUNT_SKIP``."""
    out = set()
    for word in empath_categories()[name]:
        if word in EMPATH_COUNT_SKIP:
            continue
        toks = tokenize(word)
        if len(toks) == 1 and toks[0] not in EMPATH_COUNT_SKIP:
            out.add(toks[0])
    return frozenset(out)


def _empath_terms(name: str) -> TermList:
    return TermList(empath_unigrams(name), ())


@lru_cache(maxsize=1)
def marker_terms() -> Dict[str, TermList]:
    """Vocabularies actually counted for each word-list marker."""
    terms = {name: load_terms(name) for name in WORD_LISTS}
    anger_rage = union_terms(terms["anger"], terms["rage"], _empath_terms("anger"), _empath_terms("rage"))
    swear = union_terms(terms["swear"], _empath_terms("swearing_terms"))
    return {
        "empath_intellect": union_terms(
            terms["intellect"], _empath_terms("art"), _empath_terms("reading"), _empath_terms("philosophy")),
        "swear": swear,
        "pos_emotion": union_terms(
            terms["positive_emotion"], _empath_terms("positive_emotion"), _empath_terms("affection")),
        "social": union_terms(terms["social"], _empath_terms("friends"), _empath_terms("family")),
        "anger_rage": anger_rage,
        "anger_swear": union_terms(anger_rage, swear),
        "neg_emotion": union_terms(
            terms["negative_emotion"], _empath_terms("sadness"), _empath_terms("negative_emotion")),
        "anxiety": union_terms(terms["worry"], terms["anxiety"], _empath_terms("nervousness")),
        "tentative_worry": union_terms(terms["tentative"], terms["worry"]),
        "tentative_anxiety": union_terms(terms["tentative"], terms["anxiety"], _empath_terms("nervousness")),
        "substance": terms["substance"],
        "gambling": terms["gambling"],
        "achievement_work": union_terms(
            terms["achievement_work"], _empath_terms("achievement"), _empath_terms("work")),
        "you": terms["you"],
        "craving": terms["craving"],
    }


@lru_cache(maxsize=1)
def vader_lexicon() -> VaderLexicon:
    """VADER valences keyed by token tuples. Later duplicate keys win, as in the reference loader."""
    scores: Dict[Tuple[str, ...], float] = {}
    for line in _read_required(THIRD_PARTY_DIR / "vader_lexicon.txt").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        try:
            valence = float(parts[1])
        except ValueError:
            continue
        toks = tuple(tokenize(parts[0].strip().lower()))
        if toks:
            scores[toks] = valence
    lengths = tuple(sorted({len(gram) for gram in scores}, reverse=True))
    unigrams = frozenset(gram[0] for gram in scores if len(gram) == 1)
    return VaderLexicon(scores, lengths, unigrams)


def _trait_name(key: str) -> Optional[str]:
    return _TRAIT_BY_KEY.get(key.strip().lower())


@lru_cache(maxsize=4)
def _load_wwbp_cached(dir_str: str) -> Optional[Dict[str, WeightedLexicon]]:
    directory = Path(dir_str)
    path = directory / WWBP_JSON_NAME
    if not directory.is_dir() or not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None
    if not isinstance(raw, dict):
        return None
    built: Dict[str, WeightedLexicon] = {}
    for key, terms in raw.items():
        trait = _trait_name(str(key))
        if trait is None or trait not in BIG_FIVE or not isinstance(terms, dict):
            continue
        scores: Dict[Tuple[str, ...], float] = {}
        for surface, weight in terms.items():
            if not isinstance(surface, str):
                continue
            try:
                value = float(weight)
            except (TypeError, ValueError):
                continue
            normalized = surface.strip().lower()
            toks = tuple(tokenize(normalized))
            # Punctuation and emoticon forms do not survive tokenization; keep exact term matches only.
            if not toks or " ".join(toks) != normalized:
                continue
            previous = scores.get(toks)
            if previous is None or abs(value) > abs(previous):
                scores[toks] = value
        if scores:
            built[trait] = WeightedLexicon(scores)
    return built or None


def load_wwbp() -> Optional[Dict[str, WeightedLexicon]]:
    """Per-trait n-gram weights, or None when ``wwbp/`` or its JSON is absent or unreadable.

    A term is kept only when ``features.tokenize`` reproduces it exactly, so symbol forms in the
    published file do not match ordinary words. Weights are the published weights.
    """
    return _load_wwbp_cached(str(WWBP_DIR))


def is_first_person(token: str) -> bool:
    return token in I_WORDS or token.startswith(I_PREFIX)


def is_negation(token: str) -> bool:
    return token in NEGATE or "n't" in token


def count_long_words(tokens: Sequence[str], min_letters: int = LONG_WORD_LETTERS) -> int:
    return sum(1 for tok in tokens if sum(ch.isalpha() for ch in tok) >= min_letters)


def count_vocab(tokens: Sequence[str], vocab: Iterable[str]) -> int:
    words = vocab if isinstance(vocab, frozenset) else frozenset(vocab)
    return sum(1 for tok in tokens if tok in words)


def count_terms(tokens: Sequence[str], terms: TermList) -> int:
    """Matching tokens. Longer phrases win, then leftover unigrams. No cross-message matching."""
    n = len(tokens)
    if n == 0:
        return 0
    used = [False] * n
    count = 0
    by_len: Dict[int, FrozenSet[Tuple[str, ...]]] = {}
    for phrase in terms.phrases:
        by_len.setdefault(len(phrase), set()).add(phrase)  # type: ignore[arg-type]
    for length in sorted(by_len, reverse=True):
        grams = by_len[length]
        if length > n:
            continue
        for i in range(n - length + 1):
            if used[i] or any(used[i:i + length]):
                continue
            if tuple(tokens[i:i + length]) in grams:
                for k in range(length):
                    used[i + k] = True
                count += length
    for i, tok in enumerate(tokens):
        if not used[i] and tok in terms.unigrams:
            count += 1
    return count


def count_first_person(tokens: Sequence[str], vocab: Iterable[str], window: int = FIRST_PERSON_WINDOW) -> int:
    """Vocab hits that have an I/me/my token within ``window`` tokens in the same message.

    The first-person token itself is not a hit. Distance is absolute, so the pronoun may come
    before or after the term.
    """
    words = vocab if isinstance(vocab, frozenset) else frozenset(vocab)
    pronouns = [i for i, tok in enumerate(tokens) if is_first_person(tok)]
    if not pronouns:
        return 0
    count = 0
    for i, tok in enumerate(tokens):
        if tok not in words:
            continue
        if any(0 < abs(i - j) <= window for j in pronouns):
            count += 1
    return count


def _normalize(score: float, alpha: float = VADER_ALPHA) -> float:
    norm = score / (score * score + alpha) ** 0.5
    if norm < -1.0:
        return -1.0
    if norm > 1.0:
        return 1.0
    return norm


def message_compound(tokens: Sequence[str]) -> float:
    """One message's VADER-style compound in (-1, 1), or 0 when nothing matches.

    Lexicon lookup, longest phrase first. One negation within the previous 3 tokens multiplies
    that hit by ``N_SCALAR`` (-0.74). The word "no" contributes no valence of its own when a
    lexicon word follows within 3 tokens; it still negates that word. Intensifiers, ALL-CAPS,
    and punctuation emphasis are not applied.
    """
    lex = vader_lexicon()
    n = len(tokens)
    if n == 0 or not lex.scores:
        return 0.0
    sentiments: List[float] = []
    i = 0
    while i < n:
        matched_at = None
        for length in lex.lengths:
            if i + length > n:
                continue
            gram = tuple(tokens[i:i + length])
            if gram in lex.scores:
                matched_at = (length, lex.scores[gram])
                break
        if matched_at is None:
            i += 1
            continue
        length, valence = matched_at
        token = tokens[i]
        if length == 1 and token == "no" and _lexicon_ahead(tokens, lex, i):
            i += length
            continue
        if any(is_negation(tokens[j]) for j in range(max(0, i - NEGATION_WINDOW), i)):
            valence *= N_SCALAR
        sentiments.append(valence)
        i += length
    if not sentiments:
        return 0.0
    return _normalize(sum(sentiments))


def _lexicon_ahead(tokens: Sequence[str], lex: VaderLexicon, index: int) -> bool:
    last = min(len(tokens), index + 1 + NEGATION_WINDOW)
    for j in range(index + 1, last):
        if tokens[j] in lex.unigrams:
            return True
    return False
