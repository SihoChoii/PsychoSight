# PsychoSight Lite: Experimental Scores Implementation Plan (parallel build)

Owner and integrator: PS Backend Engineer. Date: 2026-10-28. Design source: `EXPERIMENTAL_SCORES_DESIGN_v2.md`.
This plan contains no code, and the repo has not been modified. It is written to be executed by 5–6 parallel coding agents (Cursor cloud agents on Grok models or local executors) plus PS Frontend Developer.

## 0. Decisions baked in (Siho's defaults, changeable later)
1. **WWBP Big Five lexicon:** shipped with attribution and a license file, flagged *non-commercial / hackathon-only*. It is isolated in **one removable directory**, `psychosight/experimental/wwbp/`. Deleting that directory must leave everything working, with the WWBP markers reported `not_run`.
2. **Overall AI Big Five rating (holistic):** kept as one marker per Big Five dimension, at most 40% of a dimension's weight.
3. **Attachment (anxious and avoidant):** shown for every chat, `evidence_strength: very_weak`, confidence `low` only.
4. **Addictive-tendency language:** kept, `very_weak`, confidence `low` only.
5. **Other-person scoring:** on by default **in the demo only**. Real chats need the second consent.
6. **Labels:** every dimension is labelled "‹Name› (experimental language index)".

Siho's earlier decisions also hold:
- Numeric 0–100 index with band, trend and contributions.
- Thresholds of ≥ 20 agreeing episodes and ≥ 1,500 words per scored person.
- Confidence never `high`.
- Demo shows the section by default.
- About 2× DeepSeek cost is accepted.
- No diagnoses, no "has X" statements, no crisis or suicide/self-harm/relapse flags, plus a generic support footer.

## 1. Repo baseline and merge order (checked 2026-10-28, 8:10 PM PT)
| Ref | State | Touches |
|---|---|---|
| `origin/main` | PR #1 backend, PR #2 audit fixes and **PR #3 frontend (`web/`) are merged** | everything |
| PR #4 `backend/default-llm-config` | open; 7 commits on top of main | `config.py` (+114), `llm.py`, `app.py`, `cli.py`, `pipeline.py`, `rubric.py`, `synthesize.py`, new `defaults.py` and `.env.example`, docs, samples, `tests/conftest.py`, `test_api.py`, `test_llm.py` |
| `backend/rich-demo` (another worker; **only on Siho's Mac** at `~/Documents/PsychoSight`, not pushed yet; based on PR #4) | 2 commits plus uncommitted docs | `synthetic.py` (rewritten), new `psychosight/data/demo_conversation.jsonl` (4,259 msgs, 191 episodes, Sam & Robin), `scripts/make_demo_conversation.py`, deletes `tests/fixtures/demo_messages.json`, `config.py` (+22: demo provider), `llm.py`, `app.py`, `pipeline.py` (+2), `schemas/report.schema.json` (+1: `run_meta.provider_note`), `tests/conftest.py`, `test_api.py`, `test_features.py`, `test_pipeline_report.py`, `test_synthetic_loader.py`, uncommitted `README.md`, `docs/API.md`, `docs/REPORT_SCHEMA.md`, `scripts/make_samples.py` |

**Merge order:**
1. **PR #4 → main** (PS Merge Engineer).
2. **`backend/rich-demo` → main** (its worker pushes it, opens a PR and merges it after PR #4).
3. **`exp/contract`** is created from main after step 2. If step 2 is late, `exp/contract` branches from the `backend/rich-demo` tip once it is pushed and rebases onto main later.
4. **Tracks** branch from `exp/contract`.
5. **`exp/integration`** is created from `exp/contract`. Tracks merge in the order in section 5.
6. **One PR `exp/integration` → main** goes through PS Merge Engineer.

**Conflict risks with rich-demo, and how we avoid them:**
- **`pipeline.py` and `app.py`:** rich-demo adds 2–3 lines (provider note). We add one hook call and new request fields, all in Track D only, after rich-demo lands.
- **`config.py`:** rich-demo adds demo-provider code. We change **only** `SCHEMA_VERSION` there (contract). Every other experimental constant lives in `psychosight/experimental/`.
- **`schemas/report.schema.json`:** rich-demo adds `provider_note` under `run_meta`. The contract adds `$defs` and the top-level `experimental_scores` and `run_meta` fields **after** pulling rich-demo.
- **`tests/conftest.py`:** do not edit. Put new fixtures in `tests/exp_helpers.py`.
- **`scripts/make_samples.py`, docs and samples:** rich-demo has uncommitted edits. Only Track F touches these, at the very end, after rich-demo is merged.
- **`synthetic.py` / demo data:** we do **not** edit the generator. For tests with planted markers, Track F adds a separate tiny fixture builder (`tests/exp_fixtures.py`). If more marker coverage is wanted in the rich demo, F asks the rich-demo worker instead of editing it.
- **Demo provider:** rich-demo makes the demo use real DeepSeek whenever a key is configured, falling back to the mock. Our experimental LLM layer must therefore work with both `DeepSeekProvider` and `MockProvider`. Tests pin mock (`PSYCHOSIGHT_DEMO_PROVIDER=mock`).

## 2. Architecture of the change
New subpackage `psychosight/experimental/`, which keeps everything removable and conflict-free:
```
psychosight/experimental/
  __init__.py            contract    re-exports public functions
  contract.py            contract    dataclasses, enums, dimension and marker registry, versions, env names, signatures
  strings.py             contract    banner, consents, footer, scale note, how-it-works, labels, evidence notes, citations
  deterministic.py       Track A     compute_deterministic()
  lexicons.py            Track A     word-list loader and matchers (custom lists, VADER-lexicon valence, Empath subset)
  data/wordlists/*.txt   Track A     our own lists (MIT)
  data/third_party/      Track A     vader_lexicon.txt + LICENSE-VADER-MIT; empath_subset.tsv + LICENSE-EMPATH-MIT; NOTICE.md
  wwbp/                  Track A     REMOVABLE: __init__.py, bigfive_lexicon.json, LICENSE-CC-BY-NC-SA-3.0.txt, NOTICE.md
  llm_exp.py             Track B     traits-exp-v1 episode prompt and holistic prompt, validation, two-run stability, cache
  mock_exp.py            Track B     deterministic mock outputs for both prompts
  scoring.py             Track C     normalization, weights, index, bootstrap band, gating, confidence, trend, contributions
  data/exp_anchors_v1.json Track C   reference points per marker (lo, hi, anchor_source, note)
  section.py             Track D     run_experimental() orchestrator used by pipeline
```
**Pipeline position:**

`load → sessionize → features → [rubric → synthesis] → **experimental** → assemble`

A new progress stage `experimental` runs after `synthesis`, or after `features` in deterministic-only mode. The section is built from:
- the same episodes;
- the same `rubric.select_episodes()` selection when the LLM runs;
- the same `Store` (cache);
- **its own** `CallBudget`.

## 3. STEP 0: Shared contract (one agent, about 15–20 min, branch `exp/contract`)
The contract agent commits **only** the files below. Function bodies are stubs that raise `NotImplementedError`, except the constants and registry. All tests must still pass, plus `tests/test_exp_contract.py`.

### 3.1 Files the contract creates or edits
- **New:**
  - `psychosight/experimental/__init__.py`, `contract.py`, `strings.py`
  - stubs `deterministic.py`, `llm_exp.py`, `mock_exp.py`, `scoring.py`, `section.py`
  - `data/exp_anchors_v1.json` (placeholder values, marked `"draft": true`)
  - `docs/sample_experimental_scores.json` (hand-written, schema-valid, full demo-like example with me and other)
  - `docs/EXPERIMENTAL_CONTRACT.md` (a copy of this section, for agents)
  - `tests/test_exp_contract.py` (registry integrity; the stub sample validates against the schema subtree)
- **Edit:**
  - `schemas/report.schema.json`: adds `$defs` and the optional top-level `experimental_scores`, plus new `run_meta` fields. Its `schema_version` const becomes an enum `["1.0.0","1.1.0"]`, so stored older reports still load.
  - `psychosight/config.py`: `SCHEMA_VERSION = "1.1.0"` only.
  - `psychosight/mock_provider.py`: a 4-line dispatch in `MockProvider.complete()`. A system prompt starting with `TASK: EXPERIMENTAL` or `TASK: HOLISTIC` goes to `mock_exp.complete(system, user, run_idx)`.
  - `psychosight/safety.py`: adds `EXP_ALLOW_LIST`, `EXP_BANNED` and a `lint_experimental(text) -> List[str]` stub. Track D implements it.

### 3.2 Dimension keys and labels (exact)
| key | label | family | evidence_strength | max confidence |
|---|---|---|---|---|
| `openness` | Openness (experimental language index) | big_five | moderate | medium |
| `conscientiousness` | Conscientiousness (experimental language index) | big_five | moderate | medium |
| `extraversion` | Extraversion (experimental language index) | big_five | moderate | medium |
| `agreeableness` | Agreeableness (experimental language index) | big_five | moderate | medium |
| `neuroticism` | Neuroticism (experimental language index) | big_five | moderate | medium |
| `depression_language` | Depression-related language (experimental language index) | wellbeing_language | small | low |
| `anxiety_language` | Anxiety-related language (experimental language index) | wellbeing_language | small | low |
| `addictive_language` | Addictive-tendency language (experimental language index) | wellbeing_language | very_weak | low |
| `anger_hostility_language` | Anger/hostility language (experimental language index) | interpersonal | small | low |
| `narcissism_language` | Narcissism-related language (experimental language index) | interpersonal | very_weak | low |
| `attachment_anxious_language` | Anxious-attachment-related language (experimental language index) | interpersonal | very_weak | low |
| `attachment_avoidant_language` | Avoidant-attachment-related language (experimental language index) | interpersonal | very_weak | low |

Display order is the table order. Families display as "Big Five", "Well-being language" and "Interpersonal language".

### 3.3 Python contract (`contract.py`)
```python
Speaker = Literal["me", "other"]
SourceType = Literal["deterministic", "llm", "holistic"]
EvidenceStrength = Literal["moderate", "small", "weak", "very_weak"]
Confidence = Literal["low", "medium"]                      # never "high"
SectionStatus = Literal["ok", "not_run", "insufficient_data", "failed"]

@dataclass(frozen=True)
class Citation: short: str; doi: Optional[str]

@dataclass(frozen=True)
class Dimension:
    key: str; label: str; family: str; evidence_strength: EvidenceStrength
    max_confidence: Confidence; evidence_note: str; citations: Tuple[Citation, ...]

@dataclass(frozen=True)
class Marker:
    id: str                       # e.g. "neg_emotion_rate", "llm.expressed_worry", "holistic.neuroticism"
    dimension: str                # Dimension.key (one marker can be listed once per dimension; ids are unique per (id, dimension))
    label: str                    # plain words, no trait/condition words unless allow-listed
    source: SourceType
    direction: int                # +1 raises the index, -1 lowers it
    weight: float                 # evidence weight (verified |r| or floor 0.05); see registry
    unit: str                     # "% of words" | "1-5 rubric" | "lexicon units per 100 words" | "share of episodes" | "valence"
    cap_share: Optional[float]    # max share of the dimension's total weight (holistic 0.40, each llm item 0.25)
    citation: Optional[str]
    requires_wwbp: bool = False   # True for wwbp.* markers (not_run if the wwbp/ dir is absent)

@dataclass
class MarkerObservation:          # one marker, one speaker, one episode
    marker_id: str; speaker: Speaker; episode_id: str
    num: float; den: float        # pooled value = sum(num)/sum(den); rates: num=count, den=words; llm: num=agreed mean, den=1
    week: str                     # ISO week "2025-W40"

@dataclass
class ExpQuote:                   # verified verbatim span; text is resolved at assembly time
    marker_id: str; speaker: Speaker; episode_id: str; msg_idx: int; start: int; end: int

@dataclass
class DeterministicResult:
    observations: List[MarkerObservation]
    words: Dict[Speaker, int]                 # analyzed words per speaker
    episodes_with_speaker: Dict[Speaker, int] # episodes where that speaker wrote >= 1 message
    unavailable: Dict[str, str]               # marker_id -> reason (e.g. "wwbp lexicon not installed")

@dataclass
class ExpLLMStats:
    llm_calls: int = 0; llm_retries: int = 0; invalid_outputs: int = 0
    cache_hits: int = 0; cache_misses: int = 0; dropped_quotes: int = 0

@dataclass
class ExpLLMResult:
    status: SectionStatus; reason: Optional[str]
    observations: List[MarkerObservation]                     # agreed episode-level item means (1-5)
    agreeing_episodes: Dict[Speaker, int]                     # episodes with both runs valid and >= 1 agreed item
    agreement_rate: Dict[Speaker, Optional[float]]
    unstable_items: Dict[Speaker, List[str]]
    holistic: Dict[Speaker, Dict[str, Optional[float]]]       # dimension key -> mean of 2 agreeing runs (1-5) or None
    quotes: List[ExpQuote]
    stats: ExpLLMStats

# Signatures between tracks (contract stubs; owners implement)
def compute_deterministic(episodes: List[Episode], speakers: Sequence[Speaker]) -> DeterministicResult: ...      # A
def score_llm(provider: Provider, selected: List[Episode], store: Store, *, speakers: Sequence[Speaker],
              budget: CallBudget, progress: Optional[Callable[[int, int], None]] = None,
              holistic: bool = True) -> ExpLLMResult: ...                                                       # B
def build_section(det: DeterministicResult, llm: Optional[ExpLLMResult], episodes: List[Episode],
                  week_order: List[str], *, speakers: Sequence[Speaker], llm_ran: bool,
                  seed: int = 1017) -> dict: ...                                                                 # C (returns schema-valid experimental_scores)
def not_run_section(reason: str, speakers: Sequence[Speaker] = ("me",)) -> dict: ...                             # C
def run_experimental(*, episodes, selection, provider, store, llm_ran: bool, speakers, week_order,
                     progress) -> Tuple[dict, ExpLLMStats]: ...                                                  # D
```

### 3.4 Marker registry (`contract.py: MARKERS`, frozen)
Weights are evidence weights (verified |r| where one exists, floor 0.05 otherwise). Direction follows the published sign. `D` = deterministic, `R` = LLM episode item (`traits-exp-v1`), `H` = holistic LLM (`exp-holistic-v1`). Caps: each H marker ≤ 0.40 of its dimension's total weight, each R marker ≤ 0.25.

| Dimension | Markers (id, source, direction, weight) |
|---|---|
| openness | `wwbp.openness` D ↑ .43 (requires_wwbp); `long_word_share` D ↑ .10; `empath_intellect` (art/reading/philosophy) D ↑ .10; `holistic.openness` H ↑ .29 |
| conscientiousness | `wwbp.conscientiousness` D ↑ .37 (requires_wwbp); `swear_rate` D ↓ .10; `llm.follows_through_on_plans` R ↑ .05; `holistic.conscientiousness` H ↑ .29 |
| extraversion | `wwbp.extraversion` D ↑ .42 (requires_wwbp); `pos_emotion_rate` D ↑ .15; `social_word_rate` D ↑ .10; `initiation_share` D ↑ .05; `holistic.extraversion` H ↑ .29 |
| agreeableness | `wwbp.agreeableness` D ↑ .35 (requires_wwbp); `anger_swear_rate` D ↓ .15; `we_rate` D ↑ .10; `llm.validates_feelings` R ↑ .05; `llm.assigns_fault_to_other` R ↓ .05; `llm.escalating_language` R ↓ .05; `llm.repair_attempts` R ↑ .05; `holistic.agreeableness` H ↑ .29 |
| neuroticism | `wwbp.neuroticism` D ↑ .35 (requires_wwbp); `neg_emotion_rate` D ↑ .15; `anxiety_word_rate` D ↑ .10; `i_rate` D ↑ .10; `llm.expressed_worry` R ↑ .05; `llm.reassurance_seeking` R ↑ .05; `holistic.neuroticism` H ↑ .29 |
| depression_language | `i_rate` D ↑ .13; `neg_emotion_rate` D ↑ .10 (Rude 2004 anchors 1.63 → 2.92 %); `vader_compound` D ↓ .10; `absolutist_rate` D ↑ .05; `llm.hopeless_or_low_energy_wording` R ↑ .05; `llm.negative_self_evaluation` R ↑ .05 |
| anxiety_language | `anxiety_word_rate` D ↑ .10; `tentative_worry_rate` D ↑ .08; `absolutist_rate` D ↑ .05; `llm.expressed_worry` R ↑ .05; `llm.reassurance_seeking` R ↑ .05 |
| addictive_language | `substance_first_person_rate` D ↑ .05; `gambling_first_person_rate` D ↑ .05; `craving_phrase_rate` D ↑ .05; `late_night_episode_share` D ↑ .05; `llm.urge_or_loss_of_control_wording` R ↑ .05; `llm.using_to_cope_wording` R ↑ .05 |
| anger_hostility_language | `anger_rage_rate` D ↑ .12; `swear_rate` D ↑ .10; `llm.escalating_language` R ↑ .05; `llm.assigns_fault_to_other` R ↑ .05 |
| narcissism_language | `we_rate` D ↑ .05; `achievement_work_rate` D ↑ .06; `you_rate` D ↑ .06; `tentative_anxiety_rate` D ↓ .05; `llm.topic_redirect_to_self` R ↑ .05; `llm.superiority_or_entitlement_phrasing` R ↑ .05; `llm.validates_feelings` R ↓ .05. **No I-talk** (Carey 2015 r = .01). |
| attachment_anxious_language | `i_rate` D ↑ .08; `double_text_rate` D ↑ .05; `llm.reassurance_seeking` R ↑ .05; `llm.worry_about_the_relationship` R ↑ .05 |
| attachment_avoidant_language | `we_rate` D ↓ .08; `llm.emotional_disclosure` R ↓ .05; `llm.deflects_closeness` R ↑ .05 |

**Episode items in `traits-exp-v1`** (behavior-only wording, no trait or condition words): `follows_through_on_plans`, `validates_feelings`, `assigns_fault_to_other`, `escalating_language`, `repair_attempts`, `expressed_worry`, `reassurance_seeking`, `hopeless_or_low_energy_wording`, `negative_self_evaluation`, `urge_or_loss_of_control_wording`, `using_to_cope_wording`, `topic_redirect_to_self`, `superiority_or_entitlement_phrasing`, `worry_about_the_relationship`, `emotional_disclosure`, `deflects_closeness`. Items already in `rubric-v1` with the same meaning are read from the existing cache rather than re-scored.

### 3.5 Scoring rules (exact, implemented by Track C)
1. **Pooled marker value** per speaker: `x = Σnum / Σden` over that speaker's observations (rates × 100 → "% of words").
2. **Sub-score:** `s = clamp((x − lo) / (hi − lo), 0, 1)`; `s = 1 − s` when direction is −1. R and H anchors are lo = 1, hi = 5. WWBP sums use the fixed logistic squash `s = 1 / (1 + e^(−(x − c)/k))` with `c`, `k` in the anchors file. Anchors are **never** fitted to the user's data or to population norms.
3. **Caps:** after normalizing weights within a dimension, any H marker above 0.40 share and any R marker above 0.25 share is clipped and the excess redistributed proportionally to the uncapped markers (one pass, then renormalize).
4. **Index:** `score = round(100 · Σ w_m s_m / Σ w_m)` over markers with data. Needs ≥ 2 markers with data including ≥ 1 deterministic marker, else `insufficient_data` with reason.
5. **Band:** seeded bootstrap over episodes (200 resamples, `seed = 1017`), 10th–90th percentile, widened by the evidence penalty (moderate ±5, small ±10, weak ±15, very weak ±20) and by +10 more when the LLM did not run; clamp 0–100.
6. **Gating:** `insufficient_data` for a speaker below 20 agreeing episodes (LLM ran) or 20 episodes with that speaker (deterministic only), or below 1,500 words. Each speaker is gated independently.
7. **Confidence:** `low` by default. `medium` only when evidence is moderate **and** ≥ 30 episodes, ≥ 3,000 words and rubric agreement ≥ 0.8. Never `high`. Dimensions with `max_confidence: low` are always `low`.
8. **Trend:** the same formula per ISO week with ≥ 300 words and ≥ 3 episodes for that speaker; otherwise `score: null` with `reason`. No band per week.
9. **Contributions:** every marker in the registry is listed with `value`, `unit`, `sub_score`, `weight` (effective, after caps), `direction`, `anchor_source`, `status` (`ok` | `not_run` | `no_data`) and up to 2 `quote_ids`.

### 3.6 Report schema 1.1.0 (additive; `schemas/report.schema.json`)
- `schema_version`: enum `["1.0.0","1.1.0"]`. Reports without `experimental_scores` stay valid.
- New optional top-level `experimental_scores` (`$ref: #/$defs/experimentalScores`), because the root has `additionalProperties: false`.
- `$defs`:
  - `experimentalScores`: `status`, `reason`, `banner` (const), `title` (const "Experimental scores"), `scale_note` (const), `footer_support` (const), `how_it_works` (const), `scoring_version` (const "exp-scores-v1"), `prompt_versions {episode: "traits-exp-v1", holistic: "exp-holistic-v1"}`, `anchors_version` ("exp-anchors-v1"), `speakers_scored` (`["me"]` or `["me","other"]`), `thresholds {min_episodes: 20, min_words: 1500, max_confidence: "medium"}`, `dimensions[]` (exactly 12, in registry order), `quotes[]` (`$ref expQuote`).
  - `expDimension`: `key` (enum of 12), `label`, `family`, `evidence_strength`, `evidence_note`, `citations[{short, doi|null}]`, `per_speaker {me: expSpeakerScore, other: expSpeakerScore|null}`.
  - `expSpeakerScore`: `status`, `reason|null`, `score` (int 0–100 | null), `band {lo, hi}|null`, `confidence` (`low`|`medium`|null), `n_episodes`, `n_words`, `contributions[expContribution]`, `trend[{week, score|null, n_episodes, n_words, reason|null}]`, `quote_ids[]`.
  - `expContribution`: `marker_key`, `label`, `source` (`D`|`R`|`H`), `direction` (`up`|`down`), `weight`, `value|null`, `unit`, `sub_score|null`, `anchor_source`, `status`, `quote_ids[]`.
  - `expQuote`: `id` ("xq_001"…), `speaker`, `episode_id`, `marker_key`, `text` (verbatim), `ts`.
- **`run_meta` additions:** `experimental_opt_in` (bool), `score_other_opt_in` (bool), `experimental_scoring_version`, `experimental_prompt_versions`, `experimental_llm_calls`, `experimental_cache_hits`.
- **Forbidden keys anywhere under the section:** `percentile`, `t_score`, `norm`, `level`, `category`, `label_high`, `cutoff`. Enforced by a test that walks the schema and every sample.
- Experimental quotes live **only** in `experimental_scores.quotes`; they are never added to the top-level `quotes[]` and never cited by synthesis.

### 3.7 Config, API and CLI surface
**Constants (`psychosight/experimental/contract.py`):** `EXP_SCORING_VERSION = "exp-scores-v1"`, `EXP_PROMPT_VERSION = "traits-exp-v1"`, `EXP_HOLISTIC_PROMPT_VERSION = "exp-holistic-v1"`, `EXP_ANCHORS_VERSION = "exp-anchors-v1"`, `EXP_MAX_LLM_CALLS = 110`, `EXP_MIN_EPISODES = 20`, `EXP_MIN_WORDS = 1500`, `EXP_MEDIUM_EPISODES = 30`, `EXP_MEDIUM_WORDS = 3000`, `EXP_MEDIUM_AGREEMENT = 0.8`, `EXP_BOOTSTRAP = 200`, `EXP_SEED = 1017`, `EXP_HOLISTIC_MAX_WORDS = 3000`, `EXP_TREND_MIN_WORDS = 300`, `EXP_TREND_MIN_EPISODES = 3`.
**Env names:** `PSYCHOSIGHT_EXPERIMENTAL` (`0` disables the feature entirely; section becomes `not_run`, reason "disabled by configuration"), `PSYCHOSIGHT_EXP_MAX_LLM_CALLS` (override the cap).

**POST /analyses** gains:
- `experimental_scores: bool` — default `false`; default `true` for `conversation_id: "demo"`.
- `score_other: bool` — default `false`; default `true` for the demo. `score_other: true` with `experimental_scores: false` → **422 `EXPERIMENTAL_CONSENT_REQUIRED`** ("Scoring the other person requires the experimental scores consent.").
- `experimental_opt_in_text` / `score_other_opt_in_text`: the client echoes the exact consent strings it showed; a mismatch → 422 `EXPERIMENTAL_CONSENT_REQUIRED` (mirrors the existing `opt_in_text` rule). The demo does not require the echo.
- Without `llm_opt_in`, the section runs deterministic markers only. R and H markers are `not_run` and the band gets +10.
- Progress events gain stage `experimental` with `done/total` of experimental LLM calls.

**GET /config** gains: `experimental_opt_in_text`, `score_other_opt_in_text`, `experimental_banner`, `experimental_footer_support`, `experimental_scale_note`, `experimental_how_it_works`, `experimental_enabled`, `experimental_dimensions` (key, label, family, evidence_strength). The frontend renders them verbatim.

**CLI:** `analyze --experimental-scores [--score-other]`; `--demo` implies both unless `--no-experimental-scores` (which also turns off other). `--score-other` without `--experimental-scores` exits 2 with the same error code.

**Errors (`errors.py`):** add `EXPERIMENTAL_CONSENT_REQUIRED` (422). A failure inside the experimental stage never fails the analysis: the section is returned with `status: failed`, a generic reason, and the rest of the report intact.

### 3.8 Fixed strings and lint (`strings.py`, `safety.py`)
- **Banner:** "Experimental, not validated. These scores are not a diagnosis, not a personality test and not a measure of who anyone is. They come from word counts and AI ratings of this one conversation and can easily be wrong."
- **Scale note:** "0–100 experimental index. 50 is the midpoint of fixed reference points, not an average person. The shaded band shows how uncertain the number is."
- **Experimental consent:** "Show experimental personality and well-being language scores. These are 0–100 numbers built from word counts and AI ratings. They are not validated and are not a diagnosis. With AI scoring on, the same excerpts already selected are sent to DeepSeek again with extra questions."
- **Other-person consent:** "Also score the other person. They have not agreed to be scored. Their scores are an experimental reading of their messages in this conversation only, stay on this computer, and should not be shared or used to judge them."
- **Support footer (always shown, never triggered by a score):** "If anything in this conversation is weighing on you, consider talking with someone you trust or a licensed professional."
- **How it works:** the plain-English validity statement from design v2 §1, plus one evidence note per dimension ("Language markers associated in research with …; evidence: ‹strength›").
- **`EXP_ALLOW_LIST`:** exact constants only (12 labels, banner, scale note, footer, consents, how-it-works, evidence notes, holistic prompt). Applies only to strings under `experimental_scores` and to `exp-holistic-v1`.
- **`EXP_BANNED` (still banned inside the section):** `diagnos` (except in the banner), `disorder`, `clinical`, `suicid`, `self-harm`, `relapse`, `t-score`, `percentile`, `cutoff`, `elevation`, `symptom`, `patholog`, plus regexes `\byou (have|are) (a |an )?(narcissis|depress|addict|neurotic|anxious)`, `\baddict(s|ed)?\b` as a verdict, `\bat risk\b`, `\b(high|low)\b` next to a score, `\b(above|below) average\b`.
- **Global lint unchanged:** trait and condition words must appear nowhere outside the section, its prompts and its constants. `traits-exp-v1` is linted with the full banned list (it names behaviors only).

## 4. Parallel tracks
All tracks branch from `exp/contract`, edit **only** the files they own, and keep `pytest -q` green (stubs are allowed to raise in code paths the tests don't hit). Tests are offline; no new pip dependencies (third-party lexicons are vendored as data files).

### Track A: Lexicons and deterministic markers (branch `exp/a-deterministic`, ~60–75 min)
**Owns:** `experimental/deterministic.py`, `experimental/lexicons.py`, `experimental/data/wordlists/*`, `experimental/data/third_party/*`, `experimental/wwbp/*`, `tests/test_exp_deterministic.py`, `tests/test_exp_lexicons.py`.
**Tasks:**
1. Write our own MIT word lists: tentative/hedge, worry, anxiety, sadness/negative emotion, positive emotion, social, anger/rage, swear, achievement/work, second person ("you"), substance terms, gambling terms, craving/urge phrases, intellect (art/reading/philosophy). Reuse the existing absolutist list and pronoun counters from `features.py` (import, don't copy).
2. Vendor the VADER lexicon (MIT) with `LICENSE-VADER-MIT` and implement a small offline valence scorer (lexicon lookup, negation within 3 tokens, mean compound per message). Vendor the needed Empath categories (MIT) as `empath_subset.tsv` with its license. Add `NOTICE.md` listing sources and licenses.
3. Put the WWBP Big Five weighted lexicon in `experimental/wwbp/` with `LICENSE-CC-BY-NC-SA-3.0.txt` and `NOTICE.md` (attribution, "non-commercial / hackathon-only; remove before any commercial use", and the package note that scores are lexical association sums, not calibrated predictions). If the file can't be obtained offline, ship the directory without the JSON: the loader reports `unavailable["wwbp.*"] = "wwbp lexicon not installed"`.
4. `compute_deterministic(episodes, speakers)`: one `MarkerObservation` per marker × speaker × episode with `num/den` and ISO week; `words` and `episodes_with_speaker` per speaker. First-person context rule for substance/gambling terms: count only when an I/me/my token occurs within 5 tokens in the same message. `late_night_episode_share` uses `features.is_late_night`. `initiation_share` and `double_text_rate` reuse existing feature logic.
5. Tokenization must match `features.tokenize` so word counts agree with the main report.
**Acceptance:** deterministic output for a fixed input; deleting `wwbp/` gives `unavailable` entries and no exception; every D marker id in `MARKERS` is produced or listed as unavailable; license files present. Tests cover each list, negation, the first-person rule, week bucketing and the WWBP-absent path.

### Track B: LLM layer (branch `exp/b-llm`, ~60–75 min)
**Owns:** `experimental/llm_exp.py`, `experimental/mock_exp.py`, `tests/test_exp_llm.py`.
**Tasks:**
1. `traits-exp-v1` system prompt starting `TASK: EXPERIMENTAL`: behavior-only item definitions with 1–5 anchors, the existing injection-safe data block from `rubric.py`, strict JSON output `{"me": {item: {"score": 1-5|null, "quote": str|null}}, "other": {...}}`. When only "me" is scored the prompt asks for `me` only. One call per episode covers both speakers.
2. Validation mirrors `rubric.clean_output`: schema check, one retry on invalid JSON, reasoning discarded, `null` allowed for "not observed". Quotes must be verbatim **and** from the scored speaker (`rubric.locate_quote(..., speaker=...)`); otherwise the quote is dropped (`dropped_quotes += 1`) but the score is kept.
3. Two runs per episode; keep an item when |Δ| ≤ 1 (mean of the two); an episode counts as agreeing when both runs are valid and ≥ 1 item agreed. `agreement_rate` per speaker; items with agreement < 0.7 go to `unstable_items` and are excluded.
4. Reuse: items that exist in `rubric-v1` with the same meaning are read from the main rubric's cached results (same `Store`, same keys) instead of being re-asked.
5. `exp-holistic-v1` (system prompt starts `TASK: HOLISTIC`): per scored speaker, up to 3,000 words of that speaker's messages taken only from the already-selected episodes, the other side as minimal context labels; asks for 1–5 on the five domains with our own adjective anchors (not copied from any instrument). Two runs; keep a domain when |Δ| ≤ 1.
6. Cache in `Store` under keys including prompt version, model, episode hash and run index. Separate `CallBudget(EXP_MAX_LLM_CALLS)`; when exhausted, remaining episodes are skipped and the reason recorded. Concurrency 8, same as the rubric.
7. `mock_exp.complete(system, user, run_idx)`: deterministic outputs keyed on a hash of the episode text, with planted values that respond to marker words (so the planted-marker tests move in the right direction), valid verbatim quotes from the right speaker, and occasional run-to-run disagreement to exercise the stability rule.
**Acceptance:** works with `MockProvider` and `DeepSeekProvider`; never exceeds the cap; re-run is 100% cache hits; prompts pass the lint (episode prompt with the full banned list). Tests: validation, retry, stability rule, speaker-matched quotes, budget exhaustion, cache reuse, holistic word cap.

### Track C: Scoring and aggregation (branch `exp/c-scoring`, ~60–75 min)
**Owns:** `experimental/scoring.py`, `experimental/data/exp_anchors_v1.json`, `tests/test_exp_scoring.py`.
**Tasks:**
1. Fill `exp_anchors_v1.json`: `{marker_id: {lo, hi, anchor_source, note}}` (or `{c, k}` for WWBP). Use published group contrasts where available (e.g., Rude 2004 negative words 1.63 → 2.92 %) and label every other pair `"engineering anchor"`. Remove `"draft": true`.
2. Implement §3.5 exactly: pooling, sub-scores, caps with redistribution, index, the ≥ 2-marker / ≥ 1-D rule, seeded bootstrap band plus evidence and no-LLM penalties, gating, confidence, trend, contributions.
3. `build_section(...)` assembles the schema-valid `experimental_scores` dict (strings from `strings.py`, citations from the registry), resolving `ExpQuote` spans to verbatim text with ids `xq_001…`, max 2 quotes per contribution. `not_run_section(reason)` returns the same shape with every speaker `not_run`.
**Acceptance:** output validates against the 1.1.0 subtree; identical output for identical input (seeded); never `high`; weak/very weak always `low`; 19 episodes or 1,499 words → `insufficient_data` per speaker. Tests cover every rule with hand-built `DeterministicResult`/`ExpLLMResult` fixtures (no dependency on Tracks A/B).

### Track D: Pipeline, API, CLI, consent and lint wiring (branch `exp/d-wiring`, ~45–60 min)
**Owns:** `experimental/section.py`, `psychosight/pipeline.py`, `app.py`, `cli.py`, `report.py`, `errors.py`, `safety.py` (implements `lint_experimental`), `tests/test_exp_api.py`, `tests/test_exp_safety.py`, `tests/exp_helpers.py`.
**Tasks:**
1. `run_experimental(...)`: calls `compute_deterministic`, then `score_llm` when `llm_ran`, then `build_section`; wraps everything in try/except so any failure yields `status: failed` and the main report still returns. Emits progress stage `experimental`.
2. `pipeline.py`: one hook after synthesis (or after features in deterministic-only mode), passing the same episodes, the same `rubric.select_episodes()` selection, the same `Store` and a new `CallBudget`. Speakers are `("me",)` or `("me","other")` per consent.
3. `app.py`: request fields, demo defaults, the 422 `EXPERIMENTAL_CONSENT_REQUIRED` rule and consent-text echo, `/config` fields, `run_meta` fields, and `PSYCHOSIGHT_EXPERIMENTAL=0` handling. `DELETE /analyses/{id}` already removes the whole report, so experimental data goes with it (add a test).
4. `cli.py`: `--experimental-scores`, `--score-other`, `--no-experimental-scores`, demo defaults, exit code 2 on the consent error.
5. `report.py`: accept the optional section and include it; set `schema_version` to 1.1.0 whenever the report is built by this version (with or without the section).
6. `safety.py`: implement `lint_experimental` per §3.8 and run it over every string in the section before assembly; a lint hit replaces the offending string with the fixed fallback "Not shown (wording check)" and logs only the rule id (never text).
**Acceptance:** API and CLI behave per §3.7; non-demo default gives no section work (`not_run`, reason "not requested"); demo default runs it; no-LLM gives D-only with R/H `not_run`; global lint test still passes.

### Track E: Frontend (PS Frontend Developer, branch `exp/e-frontend`, ~60–90 min)
**Owns:** `web/**` only. Starts immediately from `docs/sample_experimental_scores.json` and the TypeScript types generated from §3.6.
**Tasks:**
1. Types for the section; mock data wired to the stub sample.
2. Opt-in screen: replace the two buttons with checkboxes below the existing AI opt-in: "Experimental scores" (text from `/config`) and "Also score the other person" (disabled until the first is checked). Both pre-checked only for the demo. Send the echoed consent strings.
3. One collapsed card at the bottom titled "Experimental scores", banner visible even when collapsed, never inside or beside Observations, no share/export.
4. Big Five as horizontal bars (optional radar, Big Five only) with the band shaded; other dimensions grouped under "Well-being language" and "Interpersonal language"; me and other side by side. One neutral colour; no red/green, gauges, threshold lines or high/low text.
5. Per dimension: number, band, confidence chip, evidence-strength chip, "based on n episodes / n words", expandable "Why this number" (contributions sorted by effective weight, up/down arrows, `not_run` markers greyed, quotes), weekly trend sparkline.
6. States: `insufficient_data` → "Not enough data (needs 20 episodes and 1,500 words)"; `not_run` → reason; `failed` → generic message. Footer: support line plus "How this works".
**Acceptance:** renders the stub sample, the deterministic-only sample and a report without the section; `npm run build` and frontend tests pass; no strings hard-coded that `/config` provides.

### Track F: Docs, fixtures, end-to-end tests and samples (branch `exp/f-docs-tests`, ~60–75 min)
**Owns:** `docs/EXPERIMENTAL_SCORES.md`, `docs/API.md` and `docs/REPORT_SCHEMA.md` (experimental sections only), `README.md` (one short section), `tests/exp_fixtures.py`, `tests/test_exp_e2e.py`, `tests/test_exp_schema.py`, `tests/test_exp_licenses.py`, regenerated `docs/sample_report*.json`, screenshots in `docs/img/`.
**Tasks:**
1. `docs/EXPERIMENTAL_SCORES.md`: validity statement, per-dimension evidence and citations (from design v2 §3 and §15), the scoring method, anchors and their sources, lexicon licenses, privacy, limitations.
2. `tests/exp_fixtures.py`: a tiny conversation builder with planted markers ("me" worry/negative words, "other" anger/swear words) plus a neutral control, sized above and just below the thresholds.
3. E2E tests (mock provider, network disabled): planted dimensions move in the expected direction vs control; gating at 19 vs 20 episodes and 1,499 vs 1,500 words; experimental quotes never in top-level `quotes[]` or observations; forbidden keys absent; 1.0.0 stored reports still load.
4. License test: WWBP data ships with its license and notice; no NRC or LIWC data anywhere in the repo.
5. After integration: regenerate samples with `scripts/make_samples.py` (demo full with the section, demo deterministic-only) and take screenshots of the card for the video.
**Acceptance:** all new tests pass offline; docs reviewed against the lint rules.

## 5. Dependencies, merge order, testing and schedule
**Dependency graph:**
```
PR #4 ─► rich-demo ─► exp/contract ─┬─► A (deterministic) ─┐
                                    ├─► B (LLM)  ──────────┤
                                    ├─► C (scoring) ───────┼─► exp/integration ─► PR to main (PS Merge Engineer)
                                    ├─► D (wiring) ────────┤
                                    ├─► F (docs/tests) ────┤   (F's e2e + samples finish after A–D merge)
                                    └─► E (frontend) ──────┘   (against stub sample; final check on integration)
```
**Merge order into `exp/integration`:** D → A → B → C → F → E. After each merge: `pytest -q`, then a demo run. The integrator (PS Backend Engineer) resolves conflicts; every shared file has exactly one owner (table in §2 and §4), so conflicts should be limited to `__init__.py` re-exports.

**Test commands (every track, and again on integration):**
- `python -m pytest -q`
- `PSYCHOSIGHT_DEMO_PROVIDER=mock python -m psychosight analyze --demo -o /tmp/exp_demo.json` and validate against `schemas/report.schema.json`
- `python -m psychosight analyze --demo --mode deterministic_only -o /tmp/exp_det.json`
- `cd web && npm ci && npm run build && npm test`
- Secrets scan before every push: `git diff origin/main --stat` review plus `git grep -nE "sk-[A-Za-z0-9]{20,}"` must return nothing. **Never commit a key.**

**Definition of done:**
- All tests pass offline on Python 3.9–3.13; `npm run build` passes.
- Demo shows the section by default with me and other; a real chat shows it only with consent, other only with the second consent.
- No `high` confidence anywhere; banner and footer always present; lint clean.
- Deleting `psychosight/experimental/wwbp/` keeps everything working.
- `PSYCHOSIGHT_EXPERIMENTAL=0` turns the feature off cleanly.
- Docs and samples updated; PR opened to PS Merge Engineer with a summary and screenshots.

**Schedule (wall clock, ~2 h + 30 min buffer):**
| Time | Work |
|---|---|
| 0:00–0:20 | Contract agent builds `exp/contract`; integrator reviews and pushes. Frontend briefing sent. |
| 0:20–1:35 | Tracks A, B, C, D, F and E in parallel. Integrator answers questions and checks in with PS Frontend Developer at ~0:50. |
| 1:35–2:00 | Merges D → A → B → C → F → E with tests after each; live DeepSeek smoke run on the demo. |
| 2:00–2:30 | Buffer: fixes, samples, screenshots, PR to PS Merge Engineer, video notes to PS Video Creator. |

## 6. Budgets and cost
- **Calls:** ≤ 40 selected episodes × 2 runs = 80 episode calls, plus ≤ 4 holistic calls (2 per speaker), plus retries, under a separate cap `EXP_MAX_LLM_CALLS = 110`. The main rubric's 200-call cap is untouched.
- **Time and tokens:** the current live run is about 5 minutes with ~90k input / ~280k output tokens; experimental mode roughly doubles both (Siho accepted ~2× DeepSeek cost). Concurrency stays at 8.
- **Re-runs:** free from the SQLite cache (same prompt version, model and episode hash).
- **Deterministic-only:** zero network calls; adds well under a second on the demo.

## 7. Risks and mitigations
| # | Risk | Mitigation |
|---|---|---|
| 1 | `backend/rich-demo` not pushed in time | Branch `exp/contract` from its tip once pushed; otherwise from main and rebase later; we don't touch its files until it merges. |
| 2 | WWBP lexicon unavailable offline | Removable directory; markers report `not_run`; Big Five still scored from other D markers plus H. |
| 3 | Live DeepSeek output drift vs mock | Strict validation, one retry, stability rule; live smoke run before the PR. |
| 4 | Cost or latency higher than expected | Separate 110-call cap, cache, concurrency 24 (`PSYCHOSIGHT_EXP_LLM_CONCURRENCY`), both runs in parallel, calls overlap the main rubric; holistic word cap 3,000. |
| 5 | Clinical-sounding wording slips in | Scoped allow-list, `EXP_BANNED`, fallback string, global lint test, prompt lint. |
| 6 | Misuse of other-person scores | Second consent with explicit text, demo-only default, no share/export, local storage only, delete removes it. |
| 7 | Schema compatibility | Additive 1.1.0, enum version, tests that 1.0.0 reports still load. |
| 8 | Nondeterminism breaks tests | Seeded bootstrap, deterministic mock, cache keys include run index. |
| 9 | Numbers read as verdicts | Bands always shown, confidence ≤ medium, evidence chips, banner, scale note, no thresholds or high/low text. |
| 10 | Licence misuse | Only MIT and CC BY-NC-SA data vendored with notices; NRC/LIWC excluded and checked by a test; WWBP flagged non-commercial. |

## 8. Common preamble for every agent brief
> You are working on PsychoSight Lite (repo `PsychoSight`, Python 3.9–3.13 backend in `psychosight/`, React frontend in `web/`). Read `docs/EXPERIMENTAL_CONTRACT.md` and `EXPERIMENTAL_IMPLEMENTATION_PLAN.md` §3 first; the contract is frozen, so if you need a change, stop and ask the integrator (PS Backend Engineer) instead of editing it.
> Rules:
> - Edit only the files your track owns. Do not touch `tests/conftest.py`, `synthetic.py`, demo data or `scripts/make_samples.py` unless you are Track F after integration.
> - **Never commit an API key or any secret.** Run the secrets scan before every push.
> - Non-clinical wording: no diagnoses, no "you have/are X", no crisis, suicide, self-harm or relapse flags, no percentiles, norms, cutoffs or high/low labels. Trait and condition words only inside the experimental section's allow-listed constants and the holistic prompt.
> - Tests must run offline with the mock provider (`PSYCHOSIGHT_DEMO_PROVIDER=mock`). No new pip or npm dependencies.
> - Commit small and often on your branch; push; report back with the branch name, commit list, test output and anything you could not finish.

## 9. Agent briefs (paste after the preamble)
**Contract agent (`exp/contract`):** Create everything in §3.1 exactly as specified in §3.2–§3.8: registry, dataclasses, signatures as stubs raising `NotImplementedError`, `strings.py`, schema 1.1.0, `SCHEMA_VERSION`, the mock dispatch, the `safety.py` stubs, the hand-written `docs/sample_experimental_scores.json` (12 dimensions, me and other, realistic values, one `insufficient_data` example) and `tests/test_exp_contract.py`. All existing tests must pass. Time box: 20 minutes.

**Track A (`exp/a-deterministic`):** Implement §4 Track A. Produce every D marker in `MARKERS` or list it as unavailable. Vendor VADER and the Empath subset with MIT notices; WWBP in its removable folder with the CC BY-NC-SA 3.0 license and attribution. Match `features.tokenize`.

**Track B (`exp/b-llm`):** Implement §4 Track B: `traits-exp-v1` (both speakers per call), `exp-holistic-v1`, validation with one retry, the |Δ| ≤ 1 stability rule, speaker-matched verbatim quotes, cache reuse of `rubric-v1` items, the separate 110-call budget and the deterministic mock. Must work with both `MockProvider` and `DeepSeekProvider`.

**Track C (`exp/c-scoring`):** Implement §3.5 and §4 Track C exactly, including the anchors file with sources. Build all tests from hand-made inputs so you don't depend on Tracks A or B.

**Track D (`exp/d-wiring`):** Implement §3.7 and §4 Track D: orchestrator, pipeline hook, API, CLI, report, errors and `lint_experimental`. A failure in the experimental stage must never fail the analysis.

**Track F (`exp/f-docs-tests`):** Implement §4 Track F. Write docs and fixtures now; run the e2e tests and regenerate samples and screenshots after the integrator merges A–D.

## 10. Frontend briefing (send to PS Frontend Developer)
> **What's coming:** an optional "Experimental scores" section in the report (schema 1.1.0, additive). Reports without it still validate, so nothing existing breaks.
> **Your work (Track E, `web/**` only):** see §4 Track E. Start now against `docs/sample_experimental_scores.json` (on `exp/contract`); the real backend lands on `exp/integration` in about 1.5 h.
> **Key contract points:**
> - `GET /config` adds `experimental_opt_in_text`, `score_other_opt_in_text`, `experimental_banner`, `experimental_footer_support`, `experimental_scale_note`, `experimental_how_it_works`, `experimental_enabled`, `experimental_dimensions`. Render them verbatim.
> - `POST /analyses` adds `experimental_scores`, `score_other`, and the echoed `experimental_opt_in_text` / `score_other_opt_in_text`. `score_other` without `experimental_scores` → 422 `EXPERIMENTAL_CONSENT_REQUIRED`. Demo defaults both to true.
> - Progress events add stage `experimental`.
> - Report: `experimental_scores.status` is `ok | not_run | insufficient_data | failed`; 12 `dimensions` in fixed order; each has `per_speaker.me` and `per_speaker.other` (null when not scored) with `score` (0–100 or null), `band {lo, hi}`, `confidence` (`low | medium`, never high), `n_episodes`, `n_words`, `contributions[]`, `trend[]`, `quote_ids[]`. Quotes live in `experimental_scores.quotes`, not top-level `quotes`.
> **Example (one dimension, trimmed):**
> ```json
> {"key":"neuroticism","label":"Neuroticism (experimental language index)","family":"big_five",
>  "evidence_strength":"moderate","evidence_note":"Language markers associated in research with neuroticism; evidence: moderate",
>  "citations":[{"short":"Park et al. 2015","doi":"10.1037/pspp0000020"}],
>  "per_speaker":{
>   "me":{"status":"ok","reason":null,"score":58,"band":{"lo":44,"hi":71},"confidence":"low",
>         "n_episodes":34,"n_words":4120,
>         "contributions":[{"marker_key":"neg_emotion_rate","label":"Negative-emotion words","source":"D","direction":"up",
>                           "weight":0.18,"value":2.4,"unit":"% of words","sub_score":0.6,"anchor_source":"Rude et al. 2004",
>                           "status":"ok","quote_ids":["xq_003"]}],
>         "trend":[{"week":"2025-W40","score":55,"n_episodes":6,"n_words":610,"reason":null}],
>         "quote_ids":["xq_003"]},
>   "other":null}}
> ```
> **UI rules:** collapsed card at the bottom, banner visible when collapsed, never beside Observations, no share/export, one neutral colour, no red/green, gauges, threshold lines or high/low text; always show the band, the confidence chip and the evidence chip; `insufficient_data` shows "Not enough data (needs 20 episodes and 1,500 words)". Footer: support line plus "How this works".
> I'll check in at about the 50-minute mark and again when `exp/integration` is ready for you to test against the live backend.

## 11. Video update notes (send to PS Video Creator)
> **New feature: "Experimental scores".**
> - After the normal communication-patterns report, users can open a collapsed card that turns the same conversation into 0–100 experimental indexes for the Big Five personality traits, plus language markers that research has linked to depression, anxiety, addictive tendencies, anger, narcissism and attachment styles.
> - Each number is built from word counts and AI ratings, weighted by published research. It always comes with an uncertainty band, a confidence label that never goes above "medium" and an evidence-strength label.
> - Users can score themselves, and only after a second explicit consent the other person. In the demo, both synthetic people are scored by default.
> - A "Why this number" drilldown shows exactly which word patterns and quoted messages pushed the score up or down, plus a weekly trend line.
> - The section sits under a fixed banner, "Experimental, not validated, not a diagnosis", and ends with a gentle note to talk to someone you trust or a professional if anything is weighing on you.
>
> **Key visuals:**
> - the two consent checkboxes;
> - the collapsed card with the banner;
> - expanding it to the Big Five bars (optionally a radar) with shaded bands and me vs other side by side;
> - drilling into "Neuroticism (experimental language index)" to show contributions and a quote;
> - the weekly trend sparkline.
>
> **Caveats to say or show:**
> - Experimental and not validated.
> - Not a diagnosis or a personality test.
> - Based on one conversation.
> - Evidence for narcissism, attachment and addiction language is very weak.
> - The other person must be consented to separately.
>
> Avoid phrases like "detects depression" or "finds narcissists". Screenshots will come from Track F after integration.
