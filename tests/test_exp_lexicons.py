"""Lexicon files, VADER negation, Empath subset, and the removable WWBP loader."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from psychosight.experimental import lexicons as L
from psychosight.features import tokenize

ROOT = Path(__file__).resolve().parents[1]
THIRD = ROOT / "psychosight" / "experimental" / "data" / "third_party"
WWBP = ROOT / "psychosight" / "experimental" / "wwbp"
LISTS = ROOT / "psychosight" / "experimental" / "data" / "wordlists"

# A token we expect in each of our own lists (file stem -> surface form).
OWN_PROBES = {
    "tentative": "maybe",
    "worry": "worry",
    "anxiety": "nervous",
    "negative_emotion": "sad",
    "positive_emotion": "happy",
    "social": "friend",
    "anger": "angry",
    "rage": "fuming",
    "swear": "fuck",
    "achievement_work": "deadline",
    "you": "your",
    "substance": "beer",
    "gambling": "casino",
    "craving": "can't stop",
    "intellect": "philosophy",
}
CRISIS = ("suicid", "self-harm", "selfharm", "relapse")


def _list_lines(name: str):
    lines = []
    for raw in (LISTS / "{0}.txt".format(name)).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            lines.append(line.lower())
    return lines


def test_each_own_list_loads_and_has_no_crisis_terms():
    assert set(L.WORD_LISTS) == set(OWN_PROBES)
    for name, probe in OWN_PROBES.items():
        lines = _list_lines(name)
        assert lines, name
        assert len(lines) == len(set(lines)), name
        assert probe in lines, name
        blob = " ".join(lines)
        for banned in CRISIS:
            assert banned not in blob, (name, banned)
        terms = L.load_terms(name)
        assert terms.unigrams or terms.phrases
        for line in lines:
            assert tokenize(line) == line.split(), line


def test_single_token_lists_stay_single_tokens():
    for name in L.WORD_LISTS:
        if name in ("tentative", "craving"):
            continue
        terms = L.load_terms(name)
        assert terms.phrases == (), name
        assert L.load_terms(name).unigrams


def test_tentative_and_craving_phrases_count_tokens():
    tentative = L.marker_terms()["tentative_worry"]
    assert L.count_terms(tokenize("I kind of agree"), tentative) == 2  # "kind of"
    craving = L.marker_terms()["craving"]
    assert L.count_terms(tokenize("I can't stop"), craving) == 2
    assert L.count_terms(tokenize("maybe"), tentative) == 1


def test_you_and_long_words_and_first_person_window():
    you = L.marker_terms()["you"].unigrams
    assert L.count_vocab(tokenize("your young friend"), you) == 1
    assert L.count_long_words(tokenize("beautiful cat amazing")) == 2  # beautiful, amazing
    assert L.count_long_words(tokenize("pretty")) == 0
    beer = L.marker_terms()["substance"].unigrams
    assert "beer" in beer and "cup" not in beer
    assert L.count_first_person(tokenize("beer is fine"), beer) == 0
    assert L.count_first_person(tokenize("I want a beer"), beer) == 1
    assert L.count_first_person(tokenize("my beer"), beer) == 1
    assert L.count_first_person(tokenize("I'm having wine"), beer) == 1
    assert L.count_first_person(tokenize("she bought the wine"), beer) == 0
    # 5 tokens away counts; 6 does not. The pronoun may follow the term.
    assert L.count_first_person(tokenize("beer a a a a I"), beer) == 1
    assert L.count_first_person(tokenize("beer a a a a a I"), beer) == 0
    assert L.count_first_person(tokenize("I a a a a a beer"), beer) == 0
    casino = L.marker_terms()["gambling"].unigrams
    assert "bet" not in casino
    assert L.count_first_person(tokenize("I bet you will"), casino) == 0
    assert L.count_first_person(tokenize("I went to the casino"), casino) == 1
    assert L.count_first_person(tokenize("the casino is open"), casino) == 0


def test_empath_subset_categories_and_skip_list():
    cats = L.empath_categories()
    assert set(cats) == set(L.EMPATH_CATEGORY_NAMES)
    for name, words in cats.items():
        assert words, name
    assert "ornate" in cats["art"]
    assert "nephew" in cats["family"]
    assert "melancholy" in cats["sadness"]
    assert "thinking" in cats["negative_emotion"]
    assert "always" in cats["friends"]
    assert "cup" in cats["alcohol"] and "fridge" in cats["alcohol"]
    terms = L.marker_terms()
    assert L.count_terms(tokenize("ornate"), terms["empath_intellect"]) == 1
    assert L.count_terms(tokenize("nephew"), terms["social"]) == 1
    assert L.count_terms(tokenize("melancholy"), terms["neg_emotion"]) == 1
    assert L.count_terms(tokenize("thinking"), terms["neg_emotion"]) == 0
    assert L.count_terms(tokenize("always"), terms["social"]) == 0
    assert L.count_terms(tokenize("compassion"), terms["pos_emotion"]) == 1
    assert L.count_terms(tokenize("uneasiness"), terms["anxiety"]) == 1
    assert L.count_terms(tokenize("milestone"), terms["achievement_work"]) == 1
    assert L.count_terms(tokenize("infuriate"), terms["anger_rage"]) == 1
    assert L.count_terms(tokenize("damn"), terms["swear"]) == 1
    # Empath alcohol container words are not substance terms.
    assert L.count_first_person(tokenize("I want a cup"), terms["substance"].unigrams) == 0


def test_vader_negation_window_and_compound():
    lex = L.vader_lexicon()
    happy = lex.scores[("happy",)]
    assert happy > 0
    assert lex.scores[("sad",)] < 0
    plain = L.message_compound(["happy"])
    assert plain == pytest.approx(happy / (happy * happy + L.VADER_ALPHA) ** 0.5)
    negated = L.message_compound(["not", "happy"])
    flipped = happy * L.N_SCALAR
    assert negated == pytest.approx(flipped / (flipped * flipped + L.VADER_ALPHA) ** 0.5)
    assert negated < 0 < plain
    # 4 tokens away does not flip; 3 tokens away does. Fillers are not lexicon words.
    far = L.message_compound(["not", "zza", "zzb", "zzc", "happy"])
    near = L.message_compound(["not", "zza", "zzb", "happy"])
    assert far == pytest.approx(plain)
    assert near < 0
    good = lex.scores[("good",)]
    no_good = good * L.N_SCALAR
    assert L.message_compound(["no", "good"]) == pytest.approx(
        no_good / (no_good * no_good + L.VADER_ALPHA) ** 0.5)
    assert L.message_compound(["no"]) < 0
    assert L.message_compound([]) == 0.0
    assert L.message_compound(["zza"]) == 0.0
    # Multi-word lexicon entry beats the two unigrams.
    assert ("can't", "stand") in lex.scores
    phrase = L.message_compound(tokenize("I can't stand it"))
    assert phrase < 0


def test_wwbp_published_weights_and_exact_token_match():
    raw = json.loads((WWBP / "bigfive_lexicon.json").read_text(encoding="utf-8"))
    assert set(raw) == {"O", "C", "E", "A", "N"}
    for terms in raw.values():
        weights = list(terms.values())
        assert sum(w > 0 for w in weights) == 100
        assert sum(w < 0 for w in weights) == 100
    loaded = L.load_wwbp()
    assert loaded is not None
    assert set(loaded) == {
        "openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"}
    art = raw["O"]["art"]
    assert loaded["openness"].weight(("art",)) == art
    assert loaded["openness"].sum(tokenize("art")) == art
    # Punctuation-only emoticon forms must not become the word "d".
    assert loaded["extraversion"].weight(("d",)) is None
    sick = raw["N"]["sick of"]
    assert loaded["neuroticism"].weight(("sick", "of")) == sick


def test_wwbp_missing_or_unreadable_returns_none(monkeypatch, tmp_path):
    missing = tmp_path / "gone"
    monkeypatch.setattr(L, "WWBP_DIR", missing)
    assert L.load_wwbp() is None
    bad_dir = tmp_path / "wwbp"
    bad_dir.mkdir()
    (bad_dir / L.WWBP_JSON_NAME).write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(L, "WWBP_DIR", bad_dir)
    assert L.load_wwbp() is None
    empty = tmp_path / "empty"
    empty.mkdir()
    (empty / L.WWBP_JSON_NAME).write_text("[]", encoding="utf-8")
    monkeypatch.setattr(L, "WWBP_DIR", empty)
    assert L.load_wwbp() is None


def test_license_files_present_and_no_nrc_or_liwc():
    vader = (THIRD / "LICENSE-VADER-MIT").read_text(encoding="utf-8")
    empath = (THIRD / "LICENSE-EMPATH-MIT").read_text(encoding="utf-8")
    notice = (THIRD / "NOTICE.md").read_text(encoding="utf-8")
    assert "MIT License" in vader and "C.J. Hutto" in vader
    assert "Ethan Fast" in empath and "Permission is hereby granted" in empath
    assert "vader_lexicon.txt" in notice and "empath_subset.tsv" in notice
    our = (LISTS / "LICENSE-MIT.txt").read_text(encoding="utf-8")
    assert "MIT License" in our
    cc = (WWBP / "LICENSE-CC-BY-NC-SA-3.0.txt").read_text(encoding="utf-8")
    wwbp_notice = (WWBP / "NOTICE.md").read_text(encoding="utf-8")
    assert "Attribution-NonCommercial-ShareAlike 3.0" in cc
    assert "non-commercial / hackathon-only" in wwbp_notice.lower()
    assert "not calibrated" in wwbp_notice.lower()
    assert "World Well-Being Project" in wwbp_notice
    for path in (ROOT / "psychosight" / "experimental").rglob("*"):
        low = path.name.lower()
        assert "liwc" not in low and "nrc" not in low
    assert (THIRD / "vader_lexicon.txt").is_file()
    assert (THIRD / "empath_subset.tsv").is_file()
    assert (WWBP / "bigfive_lexicon.json").is_file()
