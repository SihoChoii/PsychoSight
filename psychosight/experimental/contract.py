"""Frozen contract for the experimental scores section (plan section 3).

Owned by the integrator. Tracks import from here and never edit it; ask the integrator for changes.
Contains: versions, thresholds, env names, dimension registry, marker registry, intermediate dataclasses
and the cross-track function signatures (implemented in their owner modules, see ``TRACK_FUNCTIONS``).

Heavy psychosight modules are imported only for type checking so this module stays import-safe from
``psychosight.safety`` and ``psychosight.mock_provider``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional, Tuple

from . import strings

# ---------------------------------------------------------------- versions
EXP_SCORING_VERSION = "exp-scores-v1"
EXP_PROMPT_VERSION = "traits-exp-v1"
EXP_HOLISTIC_PROMPT_VERSION = "exp-holistic-v1"
EXP_ANCHORS_VERSION = "exp-anchors-v1"
EXP_SCHEMA_VERSION = "1.1.0"

# ---------------------------------------------------------------- thresholds and budgets
EXP_MAX_LLM_CALLS = 110
EXP_MIN_EPISODES = 20
EXP_MIN_WORDS = 1500
EXP_MEDIUM_EPISODES = 30
EXP_MEDIUM_WORDS = 3000
EXP_MEDIUM_AGREEMENT = 0.8
EXP_ITEM_MIN_AGREEMENT = 0.7          # items below this agreement rate go to unstable_items
EXP_MAX_RUN_DELTA = 1                 # keep an item/domain when |run0 - run1| <= 1
EXP_BOOTSTRAP = 200
EXP_SEED = 1017
EXP_BAND_LO_PCT = 10                  # bootstrap band: 10th..90th
EXP_BAND_HI_PCT = 90
EXP_NO_LLM_BAND_PENALTY = 10
EXP_HOLISTIC_MAX_WORDS = 3000
EXP_TREND_MIN_WORDS = 300
EXP_TREND_MIN_EPISODES = 3
EXP_MAX_QUOTES_PER_CONTRIBUTION = 2
EXP_HOLISTIC_CAP_SHARE = 0.40
EXP_ITEM_CAP_SHARE = 0.25
EXP_MIN_MARKERS_WITH_DATA = 2
EXP_MAX_CONFIDENCE = "medium"

# ---------------------------------------------------------------- environment
ENV_EXPERIMENTAL = "PSYCHOSIGHT_EXPERIMENTAL"            # "0" disables the feature (section not_run)
ENV_EXP_MAX_LLM_CALLS = "PSYCHOSIGHT_EXP_MAX_LLM_CALLS"  # integer override of EXP_MAX_LLM_CALLS

# System-prompt prefixes; MockProvider routes these to mock_exp.complete().
PROMPT_PREFIX_EPISODE = "TASK: EXPERIMENTAL"
PROMPT_PREFIX_HOLISTIC = "TASK: HOLISTIC"

# ---------------------------------------------------------------- literal types
Speaker = Literal["me", "other"]
SourceType = Literal["deterministic", "llm", "holistic"]
EvidenceStrength = Literal["moderate", "small", "weak", "very_weak"]
Confidence = Literal["low", "medium"]  # never "high"
SectionStatus = Literal["ok", "not_run", "insufficient_data", "failed"]
ContributionStatus = Literal["ok", "not_run", "no_data"]

SPEAKERS: Tuple[str, ...] = ("me", "other")
SECTION_STATUSES: Tuple[str, ...] = ("ok", "not_run", "insufficient_data", "failed")
CONTRIBUTION_STATUSES: Tuple[str, ...] = ("ok", "not_run", "no_data")
EVIDENCE_STRENGTHS: Tuple[str, ...] = ("moderate", "small", "weak", "very_weak")
CONFIDENCES: Tuple[str, ...] = ("low", "medium")
FAMILIES: Tuple[str, ...] = ("big_five", "wellbeing_language", "interpersonal")
# Report encoding of SourceType and direction.
SOURCE_CODES: Dict[str, str] = {"deterministic": "D", "llm": "R", "holistic": "H"}
DIRECTION_CODES: Dict[int, str] = {1: "up", -1: "down"}
# Band widening (+/- points) by evidence strength.
EVIDENCE_BAND_PENALTY: Dict[str, int] = {"moderate": 5, "small": 10, "weak": 15, "very_weak": 20}
# Keys that must never appear anywhere under experimental_scores (schema or report).
FORBIDDEN_KEYS: Tuple[str, ...] = ("percentile", "t_score", "norm", "level", "category", "label_high", "cutoff")

UNITS: Tuple[str, ...] = (
    "% of words", "% of messages", "1-5 rubric", "lexicon units per 100 words", "share of episodes", "valence",
)


# ---------------------------------------------------------------- registry dataclasses
@dataclass(frozen=True)
class Citation:
    short: str
    doi: Optional[str]


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    family: str
    evidence_strength: str  # EvidenceStrength
    max_confidence: str     # Confidence
    evidence_note: str
    citations: Tuple[Citation, ...]


@dataclass(frozen=True)
class Marker:
    id: str                         # e.g. "neg_emotion_rate", "llm.expressed_worry", "holistic.neuroticism"
    dimension: str                  # Dimension.key; (id, dimension) is unique
    label: str                      # plain words, no trait or condition words
    source: str                     # SourceType
    direction: int                  # +1 raises the index, -1 lowers it
    weight: float                   # evidence weight (verified |r| or floor 0.05)
    unit: str                       # one of UNITS
    cap_share: Optional[float]      # max share of the dimension's total weight (H 0.40, R 0.25, D None)
    citation: Optional[str]
    requires_wwbp: bool = False     # True for wwbp.* markers (not_run if the wwbp/ dir is absent)


# ---------------------------------------------------------------- citations
C = Citation
PARK_2015 = C("Park et al. 2015", "10.1037/pspp0000020")
AZUCAR_2018 = C("Azucar, Marengo & Settanni 2018", "10.1016/j.paid.2017.12.018")
YARKONI_2010 = C("Yarkoni 2010", "10.1016/j.jrp.2010.04.001")
PETERS_MATZ_2024 = C("Peters & Matz 2024", "10.1093/pnasnexus/pgae231")
MARENGO_2025 = C("Marengo, Montag & Settanni 2025", "10.1111/jopy.70019")
STACHL_2020 = C("Stachl et al. 2020", "10.1073/pnas.1920484117")
TACKMAN_2019 = C("Tackman et al. 2019", "10.1037/pspp0000187")
EDWARDS_HOLTZMAN_2017 = C("Edwards & Holtzman 2017", "10.1016/j.jrp.2017.02.005")
RUDE_2004 = C("Rude, Gortner & Pennebaker 2004", "10.1080/02699930441000030")
EICHSTAEDT_2018 = C("Eichstaedt et al. 2018", "10.1073/pnas.1802331115")
AL_MOSAIWI_2018 = C("Al-Mosaiwi & Johnstone 2018", "10.1177/2167702617747074")
CURTIS_2018 = C("Curtis et al. 2018", "10.1371/journal.pone.0194290")
LU_2019 = C("Lu et al. 2019", "10.1145/3292500.3330737")
SMITH_2024 = C("Smith, Peters & Reiter 2024", "10.1371/journal.pdig.0000605")
CAREY_2015 = C("Carey et al. 2015", "10.1037/pspp0000029")
HOLTZMAN_2019 = C("Holtzman et al. 2019", "10.1177/0261927X19871084")
ZHANG_2023 = C("Zhang, Fingerman & Birditt 2023", "10.1093/geronb/gbad061")
DUNLOP_2019 = C("Dunlop et al. 2019", "10.1177/1948550619847455")
HUTTO_GILBERT_2014 = C("Hutto & Gilbert 2014", None)
FAST_2016 = C("Fast, Chen & Bernstein 2016", None)
SCHWARTZ_2013 = C("Schwartz et al. 2013", "10.1371/journal.pone.0073791")
del C


def _dim(key: str, family: str, strength: str, max_conf: str, *cites: Citation) -> Dimension:
    return Dimension(key=key, label=strings.DIMENSION_LABELS[key], family=family, evidence_strength=strength,
                     max_confidence=max_conf, evidence_note=strings.EVIDENCE_NOTES[key], citations=tuple(cites))


# Display order is registry order.
DIMENSIONS: Tuple[Dimension, ...] = (
    _dim("openness", "big_five", "moderate", "medium", PARK_2015, AZUCAR_2018, YARKONI_2010, PETERS_MATZ_2024),
    _dim("conscientiousness", "big_five", "moderate", "medium", PARK_2015, AZUCAR_2018, MARENGO_2025),
    _dim("extraversion", "big_five", "moderate", "medium", PARK_2015, AZUCAR_2018, YARKONI_2010, STACHL_2020),
    _dim("agreeableness", "big_five", "moderate", "medium", PARK_2015, AZUCAR_2018, YARKONI_2010),
    _dim("neuroticism", "big_five", "moderate", "medium", PARK_2015, AZUCAR_2018, YARKONI_2010, TACKMAN_2019),
    _dim("depression_language", "wellbeing_language", "small", "low",
         EDWARDS_HOLTZMAN_2017, TACKMAN_2019, RUDE_2004, EICHSTAEDT_2018, AL_MOSAIWI_2018),
    _dim("anxiety_language", "wellbeing_language", "small", "low", YARKONI_2010, AL_MOSAIWI_2018),
    _dim("addictive_language", "wellbeing_language", "very_weak", "low", CURTIS_2018, LU_2019, SMITH_2024),
    _dim("anger_hostility_language", "interpersonal", "small", "low", YARKONI_2010),
    _dim("narcissism_language", "interpersonal", "very_weak", "low", CAREY_2015, HOLTZMAN_2019, ZHANG_2023),
    _dim("attachment_anxious_language", "interpersonal", "very_weak", "low", DUNLOP_2019),
    _dim("attachment_avoidant_language", "interpersonal", "very_weak", "low", DUNLOP_2019),
)
DIMENSION_KEYS: Tuple[str, ...] = tuple(d.key for d in DIMENSIONS)
DIMENSIONS_BY_KEY: Dict[str, Dimension] = {d.key: d for d in DIMENSIONS}
BIG_FIVE: Tuple[str, ...] = tuple(d.key for d in DIMENSIONS if d.family == "big_five")

# ---------------------------------------------------------------- episode items (traits-exp-v1)
# Behavior-only wording. Items marked True already exist in rubric-v1 with the same meaning and are
# read from the main rubric cache instead of being re-asked.
EPISODE_ITEMS: Tuple[str, ...] = (
    "follows_through_on_plans", "validates_feelings", "assigns_fault_to_other", "escalating_language",
    "repair_attempts", "expressed_worry", "reassurance_seeking", "hopeless_or_low_energy_wording",
    "negative_self_evaluation", "urge_or_loss_of_control_wording", "using_to_cope_wording",
    "topic_redirect_to_self", "superiority_or_entitlement_phrasing", "worry_about_the_relationship",
    "emotional_disclosure", "deflects_closeness",
)
RUBRIC_V1_REUSED_ITEMS: Tuple[str, ...] = (
    "validates_feelings", "assigns_fault_to_other", "escalating_language", "repair_attempts",
    "topic_redirect_to_self",
)
EPISODE_ITEM_LABELS: Dict[str, str] = {
    "follows_through_on_plans": "Follows through on plans (AI rating)",
    "validates_feelings": "Validates the other person's feelings (AI rating)",
    "assigns_fault_to_other": "Puts fault on the other person (AI rating)",
    "escalating_language": "Escalating wording (AI rating)",
    "repair_attempts": "Repair attempts (AI rating)",
    "expressed_worry": "Expressed worry (AI rating)",
    "reassurance_seeking": "Asks for reassurance (AI rating)",
    "hopeless_or_low_energy_wording": "Hopeless or low-energy wording (AI rating)",
    "negative_self_evaluation": "Negative statements about oneself (AI rating)",
    "urge_or_loss_of_control_wording": "Urge or loss-of-control wording (AI rating)",
    "using_to_cope_wording": "Using something to cope (AI rating)",
    "topic_redirect_to_self": "Steers the topic to oneself (AI rating)",
    "superiority_or_entitlement_phrasing": "Superiority or entitlement phrasing (AI rating)",
    "worry_about_the_relationship": "Worry about the relationship (AI rating)",
    "emotional_disclosure": "Shares own feelings (AI rating)",
    "deflects_closeness": "Deflects closeness (AI rating)",
}

# ---------------------------------------------------------------- deterministic marker labels and units
D_MARKERS: Dict[str, Tuple[str, str]] = {  # id -> (label, unit)
    "long_word_share": ("Long words (7+ letters)", "% of words"),
    "empath_intellect": ("Art, reading and ideas words", "% of words"),
    "swear_rate": ("Swear words", "% of words"),
    "pos_emotion_rate": ("Positive-emotion words", "% of words"),
    "social_word_rate": ("Social words (friends, family, people)", "% of words"),
    "initiation_share": ("Starts the episode", "share of episodes"),
    "anger_swear_rate": ("Anger and swear words", "% of words"),
    "we_rate": ("We/us/our words", "% of words"),
    "neg_emotion_rate": ("Negative-emotion words", "% of words"),
    "anxiety_word_rate": ("Worry and nervousness words", "% of words"),
    "i_rate": ("I/me/my words", "% of words"),
    "vader_compound": ("Overall message tone (VADER)", "valence"),
    "absolutist_rate": ("Absolutist words (always, never, ...)", "% of words"),
    "tentative_worry_rate": ("Tentative and worry words", "% of words"),
    "substance_first_person_rate": ("Alcohol or drug words near I/me/my", "% of words"),
    "gambling_first_person_rate": ("Betting words near I/me/my", "% of words"),
    "craving_phrase_rate": ("Craving or urge phrases", "% of words"),
    "late_night_episode_share": ("Episodes started 01:00-04:00", "share of episodes"),
    "anger_rage_rate": ("Anger and rage words", "% of words"),
    "achievement_work_rate": ("Achievement and work words", "% of words"),
    "you_rate": ("You/your words", "% of words"),
    "tentative_anxiety_rate": ("Tentative and anxious-sounding words", "% of words"),
    "double_text_rate": ("Double texts (two messages in a row)", "% of messages"),
}
WWBP_LABEL = "WWBP weighted word list for this dimension"
HOLISTIC_LABEL = "Overall AI rating for this dimension"


def _d(dim: str, mid: str, direction: int, weight: float, citation: Optional[str] = None) -> "Marker":
    label, unit = D_MARKERS[mid]
    return Marker(mid, dim, label, "deterministic", direction, weight, unit, None, citation)


def _w(dim: str, weight: float) -> "Marker":
    return Marker(f"wwbp.{dim}", dim, WWBP_LABEL, "deterministic", 1, weight, "lexicon units per 100 words", None,
                  "Park et al. 2015", requires_wwbp=True)


def _r(dim: str, item: str, direction: int, weight: float = 0.05) -> "Marker":
    return Marker(f"llm.{item}", dim, EPISODE_ITEM_LABELS[item], "llm", direction, weight, "1-5 rubric",
                  EXP_ITEM_CAP_SHARE, None)


def _h(dim: str, weight: float = 0.29) -> "Marker":
    return Marker(f"holistic.{dim}", dim, HOLISTIC_LABEL, "holistic", 1, weight, "1-5 rubric",
                  EXP_HOLISTIC_CAP_SHARE, "Peters & Matz 2024")


# Frozen marker registry (plan section 3.4). Order within a dimension is the display order of contributions
# before sorting by effective weight.
MARKERS: Tuple[Marker, ...] = (
    # openness
    _w("openness", 0.43), _d("openness", "long_word_share", 1, 0.10, "Yarkoni 2010"),
    _d("openness", "empath_intellect", 1, 0.10, "Yarkoni 2010"), _h("openness"),
    # conscientiousness
    _w("conscientiousness", 0.37), _d("conscientiousness", "swear_rate", -1, 0.10, "Yarkoni 2010"),
    _r("conscientiousness", "follows_through_on_plans", 1), _h("conscientiousness"),
    # extraversion
    _w("extraversion", 0.42), _d("extraversion", "pos_emotion_rate", 1, 0.15, "Yarkoni 2010"),
    _d("extraversion", "social_word_rate", 1, 0.10, "Yarkoni 2010"),
    _d("extraversion", "initiation_share", 1, 0.05, "Stachl et al. 2020"), _h("extraversion"),
    # agreeableness
    _w("agreeableness", 0.35), _d("agreeableness", "anger_swear_rate", -1, 0.15, "Yarkoni 2010"),
    _d("agreeableness", "we_rate", 1, 0.10, "Yarkoni 2010"),
    _r("agreeableness", "validates_feelings", 1), _r("agreeableness", "assigns_fault_to_other", -1),
    _r("agreeableness", "escalating_language", -1), _r("agreeableness", "repair_attempts", 1),
    _h("agreeableness"),
    # neuroticism
    _w("neuroticism", 0.35), _d("neuroticism", "neg_emotion_rate", 1, 0.15, "Yarkoni 2010"),
    _d("neuroticism", "anxiety_word_rate", 1, 0.10, "Yarkoni 2010"),
    _d("neuroticism", "i_rate", 1, 0.10, "Tackman et al. 2019"),
    _r("neuroticism", "expressed_worry", 1), _r("neuroticism", "reassurance_seeking", 1), _h("neuroticism"),
    # depression_language
    _d("depression_language", "i_rate", 1, 0.13, "Edwards & Holtzman 2017"),
    _d("depression_language", "neg_emotion_rate", 1, 0.10, "Rude, Gortner & Pennebaker 2004"),
    _d("depression_language", "vader_compound", -1, 0.10, "Hutto & Gilbert 2014"),
    _d("depression_language", "absolutist_rate", 1, 0.05, "Al-Mosaiwi & Johnstone 2018"),
    _r("depression_language", "hopeless_or_low_energy_wording", 1),
    _r("depression_language", "negative_self_evaluation", 1),
    # anxiety_language
    _d("anxiety_language", "anxiety_word_rate", 1, 0.10, "Yarkoni 2010"),
    _d("anxiety_language", "tentative_worry_rate", 1, 0.08),
    _d("anxiety_language", "absolutist_rate", 1, 0.05, "Al-Mosaiwi & Johnstone 2018"),
    _r("anxiety_language", "expressed_worry", 1), _r("anxiety_language", "reassurance_seeking", 1),
    # addictive_language
    _d("addictive_language", "substance_first_person_rate", 1, 0.05),
    _d("addictive_language", "gambling_first_person_rate", 1, 0.05),
    _d("addictive_language", "craving_phrase_rate", 1, 0.05),
    _d("addictive_language", "late_night_episode_share", 1, 0.05),
    _r("addictive_language", "urge_or_loss_of_control_wording", 1),
    _r("addictive_language", "using_to_cope_wording", 1),
    # anger_hostility_language
    _d("anger_hostility_language", "anger_rage_rate", 1, 0.12, "Yarkoni 2010"),
    _d("anger_hostility_language", "swear_rate", 1, 0.10, "Yarkoni 2010"),
    _r("anger_hostility_language", "escalating_language", 1),
    _r("anger_hostility_language", "assigns_fault_to_other", 1),
    # narcissism_language (no I-talk: Carey et al. 2015, r = .01)
    _d("narcissism_language", "we_rate", 1, 0.05, "Zhang, Fingerman & Birditt 2023"),
    _d("narcissism_language", "achievement_work_rate", 1, 0.06, "Zhang, Fingerman & Birditt 2023"),
    _d("narcissism_language", "you_rate", 1, 0.06, "Holtzman et al. 2019"),
    _d("narcissism_language", "tentative_anxiety_rate", -1, 0.05, "Holtzman et al. 2019"),
    _r("narcissism_language", "topic_redirect_to_self", 1),
    _r("narcissism_language", "superiority_or_entitlement_phrasing", 1),
    _r("narcissism_language", "validates_feelings", -1),
    # attachment_anxious_language
    _d("attachment_anxious_language", "i_rate", 1, 0.08, "Dunlop et al. 2019"),
    _d("attachment_anxious_language", "double_text_rate", 1, 0.05),
    _r("attachment_anxious_language", "reassurance_seeking", 1),
    _r("attachment_anxious_language", "worry_about_the_relationship", 1),
    # attachment_avoidant_language
    _d("attachment_avoidant_language", "we_rate", -1, 0.08, "Dunlop et al. 2019"),
    _r("attachment_avoidant_language", "emotional_disclosure", -1),
    _r("attachment_avoidant_language", "deflects_closeness", 1),
)


def markers_for(dimension: str) -> Tuple[Marker, ...]:
    return tuple(m for m in MARKERS if m.dimension == dimension)


def deterministic_marker_ids() -> Tuple[str, ...]:
    """Unique D marker ids (including wwbp.*), in first-seen registry order. Track A must produce or list each."""
    seen: List[str] = []
    for m in MARKERS:
        if m.source == "deterministic" and m.id not in seen:
            seen.append(m.id)
    return tuple(seen)


# ---------------------------------------------------------------- intermediate dataclasses
@dataclass
class MarkerObservation:
    """One marker, one speaker, one episode. Pooled value = sum(num) / sum(den).

    Rates: num = count, den = words (pooled x100 -> "% of words"). LLM items: num = agreed mean, den = 1.
    Episode shares (initiation, late night): num = 0/1, den = 1. Valence: num = sum of message compounds,
    den = messages.
    """
    marker_id: str
    speaker: str   # Speaker
    episode_id: str
    num: float
    den: float
    week: str      # ISO week "2025-W40"


@dataclass
class ExpQuote:
    """Verified verbatim span; text is resolved at assembly time (msg_idx indexes Episode.msgs)."""
    marker_id: str
    speaker: str
    episode_id: str
    msg_idx: int
    start: int
    end: int


@dataclass
class DeterministicResult:
    observations: List[MarkerObservation]
    words: Dict[str, int]                  # analyzed words per speaker
    episodes_with_speaker: Dict[str, int]  # episodes where that speaker wrote >= 1 message
    unavailable: Dict[str, str]            # marker_id -> reason (e.g. strings.REASON_WWBP_MISSING)


@dataclass
class ExpLLMStats:
    llm_calls: int = 0
    llm_retries: int = 0
    invalid_outputs: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    dropped_quotes: int = 0


@dataclass
class ExpLLMResult:
    status: str                                    # SectionStatus
    reason: Optional[str]
    observations: List[MarkerObservation]          # agreed episode-level item means (1-5), marker_id "llm.<item>"
    agreeing_episodes: Dict[str, int]              # episodes with both runs valid and >= 1 agreed item
    agreement_rate: Dict[str, Optional[float]]
    unstable_items: Dict[str, List[str]]           # speaker -> item keys (without "llm." prefix)
    holistic: Dict[str, Dict[str, Optional[float]]]  # speaker -> Big Five key -> mean of 2 agreeing runs or None
    quotes: List[ExpQuote]
    stats: ExpLLMStats = field(default_factory=ExpLLMStats)


# ---------------------------------------------------------------- cross-track signatures
# Implemented in their owner modules (tests check the parameter names):
#   deterministic.compute_deterministic(episodes, speakers) -> DeterministicResult                      Track A
#   llm_exp.score_llm(provider, selected, store, *, speakers, budget, progress=None, holistic=True,
#                     before_merge=None, abort=None)
#       -> ExpLLMResult                                                                                 Track B
#   mock_exp.complete(system, user, run_idx=0) -> llm.LLMResult                                         Track B
#   scoring.build_section(det, llm, episodes, week_order, *, speakers, llm_ran, seed=EXP_SEED) -> dict   Track C
#   scoring.not_run_section(reason, speakers=("me",)) -> dict                                           Track C
#   section.run_experimental(*, episodes, selection, provider, store, llm_ran, speakers, week_order,
#       progress, before_merge=None, abort=None) -> Tuple[dict, ExpLLMStats]                                                           Track D
#   safety.lint_experimental(text) -> List[str]                                                         Track D
TRACK_FUNCTIONS: Dict[str, Tuple[str, Tuple[str, ...]]] = {
    "compute_deterministic": ("psychosight.experimental.deterministic", ("episodes", "speakers")),
    "score_llm": ("psychosight.experimental.llm_exp",
                  ("provider", "selected", "store", "speakers", "budget", "progress", "holistic",
                   "before_merge", "abort")),
    "complete": ("psychosight.experimental.mock_exp", ("system", "user", "run_idx")),
    "build_section": ("psychosight.experimental.scoring",
                      ("det", "llm", "episodes", "week_order", "speakers", "llm_ran", "seed")),
    "not_run_section": ("psychosight.experimental.scoring", ("reason", "speakers")),
    "run_experimental": ("psychosight.experimental.section",
                         ("episodes", "selection", "provider", "store", "llm_ran", "speakers", "week_order",
                          "progress", "before_merge", "abort")),
    "lint_experimental": ("psychosight.safety", ("text",)),
}
