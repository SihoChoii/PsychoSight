# Experimental scores: frozen contract (exp/contract)

Source of truth for Tracks A–F. Python source: `psychosight/experimental/contract.py` and `strings.py`; schema: `schemas/report.schema.json` (1.1.0); example: `docs/sample_experimental_scores.json`. Full plan and design: `docs/experimental/IMPLEMENTATION_PLAN.md`, `docs/experimental/SCORES_DESIGN_v2.md`.

The contract is frozen. If a track needs a change, stop and ask the integrator (PS Backend Engineer). `tests/test_exp_contract.py` pins the registry, constants, strings, signatures and schema.

## 1. Files and owners

| Path | Owner | State on exp/contract |
|---|---|---|
| `psychosight/experimental/__init__.py, contract.py, strings.py` | contract (frozen) | done |
| `psychosight/experimental/deterministic.py, lexicons.py, data/wordlists/, data/third_party/, wwbp/` | Track A | stub (`compute_deterministic`); lexicons.py and data dirs not created |
| `psychosight/experimental/llm_exp.py, mock_exp.py` | Track B | stubs |
| `psychosight/experimental/scoring.py, data/exp_anchors_v1.json` | Track C | stub; anchors placeholder with `"draft": true` |
| `psychosight/experimental/section.py, pipeline.py, app.py, cli.py, report.py, errors.py, safety.py (`lint_experimental`)` | Track D | stubs; safety constants done |
| `web/**` | Track E | untouched |
| `docs (other than this file), tests/exp_fixtures.py, samples` | Track F | untouched |
| `psychosight/mock_provider.py` | contract | dispatch added |
| `psychosight/config.py` | contract | `SCHEMA_VERSION = "1.1.0"` only |

## 2. Versions, thresholds, env (`contract.py`)

```
EXP_SCORING_VERSION = 'exp-scores-v1'
EXP_PROMPT_VERSION = 'traits-exp-v1'
EXP_HOLISTIC_PROMPT_VERSION = 'exp-holistic-v1'
EXP_ANCHORS_VERSION = 'exp-anchors-v1'
EXP_SCHEMA_VERSION = '1.1.0'
EXP_MAX_LLM_CALLS = 110
EXP_MIN_EPISODES = 20
EXP_MIN_WORDS = 1500
EXP_MEDIUM_EPISODES = 30
EXP_MEDIUM_WORDS = 3000
EXP_MEDIUM_AGREEMENT = 0.8
EXP_ITEM_MIN_AGREEMENT = 0.7
EXP_MAX_RUN_DELTA = 1
EXP_BOOTSTRAP = 200
EXP_SEED = 1017
EXP_BAND_LO_PCT = 10
EXP_BAND_HI_PCT = 90
EXP_NO_LLM_BAND_PENALTY = 10
EXP_HOLISTIC_MAX_WORDS = 3000
EXP_TREND_MIN_WORDS = 300
EXP_TREND_MIN_EPISODES = 3
EXP_MAX_QUOTES_PER_CONTRIBUTION = 2
EXP_HOLISTIC_CAP_SHARE = 0.4
EXP_ITEM_CAP_SHARE = 0.25
EXP_MIN_MARKERS_WITH_DATA = 2
EXP_MAX_CONFIDENCE = 'medium'
EVIDENCE_BAND_PENALTY = {'moderate': 5, 'small': 10, 'weak': 15, 'very_weak': 20}
ENV_EXPERIMENTAL = 'PSYCHOSIGHT_EXPERIMENTAL'
ENV_EXP_MAX_LLM_CALLS = 'PSYCHOSIGHT_EXP_MAX_LLM_CALLS'
PROMPT_PREFIX_EPISODE = 'TASK: EXPERIMENTAL'
PROMPT_PREFIX_HOLISTIC = 'TASK: HOLISTIC'
FORBIDDEN_KEYS = ('percentile', 't_score', 'norm', 'level', 'category', 'label_high', 'cutoff')
UNITS = ('% of words', '% of messages', '1-5 rubric', 'lexicon units per 100 words', 'share of episodes', 'valence')
```

- `PSYCHOSIGHT_EXPERIMENTAL=0` disables the feature: the section is `not_run` with reason `"disabled by configuration"`.
- `PSYCHOSIGHT_EXP_MAX_LLM_CALLS=<int>` overrides the separate experimental call cap (main rubric cap of 200 is untouched).

## 3. Dimensions (display order)

| key | label | family | evidence_strength | max confidence | citations |
|---|---|---|---|---|---|
| `openness` | Openness (experimental language index) | big_five | moderate | medium | Park et al. 2015; Azucar, Marengo & Settanni 2018; Yarkoni 2010; Peters & Matz 2024 |
| `conscientiousness` | Conscientiousness (experimental language index) | big_five | moderate | medium | Park et al. 2015; Azucar, Marengo & Settanni 2018; Marengo, Montag & Settanni 2025 |
| `extraversion` | Extraversion (experimental language index) | big_five | moderate | medium | Park et al. 2015; Azucar, Marengo & Settanni 2018; Yarkoni 2010; Stachl et al. 2020 |
| `agreeableness` | Agreeableness (experimental language index) | big_five | moderate | medium | Park et al. 2015; Azucar, Marengo & Settanni 2018; Yarkoni 2010 |
| `neuroticism` | Neuroticism (experimental language index) | big_five | moderate | medium | Park et al. 2015; Azucar, Marengo & Settanni 2018; Yarkoni 2010; Tackman et al. 2019 |
| `depression_language` | Depression-related language (experimental language index) | wellbeing_language | small | low | Edwards & Holtzman 2017; Tackman et al. 2019; Rude, Gortner & Pennebaker 2004; Eichstaedt et al. 2018; Al-Mosaiwi & Johnstone 2018 |
| `anxiety_language` | Anxiety-related language (experimental language index) | wellbeing_language | small | low | Yarkoni 2010; Al-Mosaiwi & Johnstone 2018 |
| `addictive_language` | Addictive-tendency language (experimental language index) | wellbeing_language | very_weak | low | Curtis et al. 2018; Lu et al. 2019; Smith, Peters & Reiter 2024 |
| `anger_hostility_language` | Anger/hostility language (experimental language index) | interpersonal | small | low | Yarkoni 2010 |
| `narcissism_language` | Narcissism-related language (experimental language index) | interpersonal | very_weak | low | Carey et al. 2015; Holtzman et al. 2019; Zhang, Fingerman & Birditt 2023 |
| `attachment_anxious_language` | Anxious-attachment-related language (experimental language index) | interpersonal | very_weak | low | Dunlop et al. 2019 |
| `attachment_avoidant_language` | Avoidant-attachment-related language (experimental language index) | interpersonal | very_weak | low | Dunlop et al. 2019 |

Families display as `big_five` → "Big Five", `wellbeing_language` → "Well-being language", `interpersonal` → "Interpersonal language". Evidence notes follow `"Language markers associated in research with <topic>; evidence: <strength>"` (`strings.EVIDENCE_NOTES`).

## 4. Marker registry (`contract.MARKERS`, frozen)

Source codes: D deterministic, R LLM episode item (`traits-exp-v1`), H holistic LLM (`exp-holistic-v1`). Caps: H ≤ 0.40, R ≤ 0.25 of the dimension's weight. `requires_wwbp` markers are `not_run` when `psychosight/experimental/wwbp/` is absent.

| dimension | marker id | src | dir | weight | unit | label |
|---|---|---|---|---|---|---|
| openness | `wwbp.openness` | D | ↑ | 0.43 | lexicon units per 100 words | WWBP weighted word list for this dimension |
| openness | `long_word_share` | D | ↑ | 0.1 | % of words | Long words (7+ letters) |
| openness | `empath_intellect` | D | ↑ | 0.1 | % of words | Art, reading and ideas words |
| openness | `holistic.openness` | H | ↑ | 0.29 | 1-5 rubric | Overall AI rating for this dimension |
| conscientiousness | `wwbp.conscientiousness` | D | ↑ | 0.37 | lexicon units per 100 words | WWBP weighted word list for this dimension |
| conscientiousness | `swear_rate` | D | ↓ | 0.1 | % of words | Swear words |
| conscientiousness | `llm.follows_through_on_plans` | R | ↑ | 0.05 | 1-5 rubric | Follows through on plans (AI rating) |
| conscientiousness | `holistic.conscientiousness` | H | ↑ | 0.29 | 1-5 rubric | Overall AI rating for this dimension |
| extraversion | `wwbp.extraversion` | D | ↑ | 0.42 | lexicon units per 100 words | WWBP weighted word list for this dimension |
| extraversion | `pos_emotion_rate` | D | ↑ | 0.15 | % of words | Positive-emotion words |
| extraversion | `social_word_rate` | D | ↑ | 0.1 | % of words | Social words (friends, family, people) |
| extraversion | `initiation_share` | D | ↑ | 0.05 | share of episodes | Starts the episode |
| extraversion | `holistic.extraversion` | H | ↑ | 0.29 | 1-5 rubric | Overall AI rating for this dimension |
| agreeableness | `wwbp.agreeableness` | D | ↑ | 0.35 | lexicon units per 100 words | WWBP weighted word list for this dimension |
| agreeableness | `anger_swear_rate` | D | ↓ | 0.15 | % of words | Anger and swear words |
| agreeableness | `we_rate` | D | ↑ | 0.1 | % of words | We/us/our words |
| agreeableness | `llm.validates_feelings` | R | ↑ | 0.05 | 1-5 rubric | Validates the other person's feelings (AI rating) |
| agreeableness | `llm.assigns_fault_to_other` | R | ↓ | 0.05 | 1-5 rubric | Puts fault on the other person (AI rating) |
| agreeableness | `llm.escalating_language` | R | ↓ | 0.05 | 1-5 rubric | Escalating wording (AI rating) |
| agreeableness | `llm.repair_attempts` | R | ↑ | 0.05 | 1-5 rubric | Repair attempts (AI rating) |
| agreeableness | `holistic.agreeableness` | H | ↑ | 0.29 | 1-5 rubric | Overall AI rating for this dimension |
| neuroticism | `wwbp.neuroticism` | D | ↑ | 0.35 | lexicon units per 100 words | WWBP weighted word list for this dimension |
| neuroticism | `neg_emotion_rate` | D | ↑ | 0.15 | % of words | Negative-emotion words |
| neuroticism | `anxiety_word_rate` | D | ↑ | 0.1 | % of words | Worry and nervousness words |
| neuroticism | `i_rate` | D | ↑ | 0.1 | % of words | I/me/my words |
| neuroticism | `llm.expressed_worry` | R | ↑ | 0.05 | 1-5 rubric | Expressed worry (AI rating) |
| neuroticism | `llm.reassurance_seeking` | R | ↑ | 0.05 | 1-5 rubric | Asks for reassurance (AI rating) |
| neuroticism | `holistic.neuroticism` | H | ↑ | 0.29 | 1-5 rubric | Overall AI rating for this dimension |
| depression_language | `i_rate` | D | ↑ | 0.13 | % of words | I/me/my words |
| depression_language | `neg_emotion_rate` | D | ↑ | 0.1 | % of words | Negative-emotion words |
| depression_language | `vader_compound` | D | ↓ | 0.1 | valence | Overall message tone (VADER) |
| depression_language | `absolutist_rate` | D | ↑ | 0.05 | % of words | Absolutist words (always, never, ...) |
| depression_language | `llm.hopeless_or_low_energy_wording` | R | ↑ | 0.05 | 1-5 rubric | Hopeless or low-energy wording (AI rating) |
| depression_language | `llm.negative_self_evaluation` | R | ↑ | 0.05 | 1-5 rubric | Negative statements about oneself (AI rating) |
| anxiety_language | `anxiety_word_rate` | D | ↑ | 0.1 | % of words | Worry and nervousness words |
| anxiety_language | `tentative_worry_rate` | D | ↑ | 0.08 | % of words | Tentative and worry words |
| anxiety_language | `absolutist_rate` | D | ↑ | 0.05 | % of words | Absolutist words (always, never, ...) |
| anxiety_language | `llm.expressed_worry` | R | ↑ | 0.05 | 1-5 rubric | Expressed worry (AI rating) |
| anxiety_language | `llm.reassurance_seeking` | R | ↑ | 0.05 | 1-5 rubric | Asks for reassurance (AI rating) |
| addictive_language | `substance_first_person_rate` | D | ↑ | 0.05 | % of words | Alcohol or drug words near I/me/my |
| addictive_language | `gambling_first_person_rate` | D | ↑ | 0.05 | % of words | Betting words near I/me/my |
| addictive_language | `craving_phrase_rate` | D | ↑ | 0.05 | % of words | Craving or urge phrases |
| addictive_language | `late_night_episode_share` | D | ↑ | 0.05 | share of episodes | Episodes started 01:00-04:00 |
| addictive_language | `llm.urge_or_loss_of_control_wording` | R | ↑ | 0.05 | 1-5 rubric | Urge or loss-of-control wording (AI rating) |
| addictive_language | `llm.using_to_cope_wording` | R | ↑ | 0.05 | 1-5 rubric | Using something to cope (AI rating) |
| anger_hostility_language | `anger_rage_rate` | D | ↑ | 0.12 | % of words | Anger and rage words |
| anger_hostility_language | `swear_rate` | D | ↑ | 0.1 | % of words | Swear words |
| anger_hostility_language | `llm.escalating_language` | R | ↑ | 0.05 | 1-5 rubric | Escalating wording (AI rating) |
| anger_hostility_language | `llm.assigns_fault_to_other` | R | ↑ | 0.05 | 1-5 rubric | Puts fault on the other person (AI rating) |
| narcissism_language | `we_rate` | D | ↑ | 0.05 | % of words | We/us/our words |
| narcissism_language | `achievement_work_rate` | D | ↑ | 0.06 | % of words | Achievement and work words |
| narcissism_language | `you_rate` | D | ↑ | 0.06 | % of words | You/your words |
| narcissism_language | `tentative_anxiety_rate` | D | ↓ | 0.05 | % of words | Tentative and anxious-sounding words |
| narcissism_language | `llm.topic_redirect_to_self` | R | ↑ | 0.05 | 1-5 rubric | Steers the topic to oneself (AI rating) |
| narcissism_language | `llm.superiority_or_entitlement_phrasing` | R | ↑ | 0.05 | 1-5 rubric | Superiority or entitlement phrasing (AI rating) |
| narcissism_language | `llm.validates_feelings` | R | ↓ | 0.05 | 1-5 rubric | Validates the other person's feelings (AI rating) |
| attachment_anxious_language | `i_rate` | D | ↑ | 0.08 | % of words | I/me/my words |
| attachment_anxious_language | `double_text_rate` | D | ↑ | 0.05 | % of messages | Double texts (two messages in a row) |
| attachment_anxious_language | `llm.reassurance_seeking` | R | ↑ | 0.05 | 1-5 rubric | Asks for reassurance (AI rating) |
| attachment_anxious_language | `llm.worry_about_the_relationship` | R | ↑ | 0.05 | 1-5 rubric | Worry about the relationship (AI rating) |
| attachment_avoidant_language | `we_rate` | D | ↓ | 0.08 | % of words | We/us/our words |
| attachment_avoidant_language | `llm.emotional_disclosure` | R | ↓ | 0.05 | 1-5 rubric | Shares own feelings (AI rating) |
| attachment_avoidant_language | `llm.deflects_closeness` | R | ↑ | 0.05 | 1-5 rubric | Deflects closeness (AI rating) |

Episode items in `traits-exp-v1` (behavior-only, no trait or condition words): `follows_through_on_plans`, `validates_feelings`, `assigns_fault_to_other`, `escalating_language`, `repair_attempts`, `expressed_worry`, `reassurance_seeking`, `hopeless_or_low_energy_wording`, `negative_self_evaluation`, `urge_or_loss_of_control_wording`, `using_to_cope_wording`, `topic_redirect_to_self`, `superiority_or_entitlement_phrasing`, `worry_about_the_relationship`, `emotional_disclosure`, `deflects_closeness`.
Read from the existing `rubric-v1` cache instead of re-asking: `validates_feelings`, `assigns_fault_to_other`, `escalating_language`, `repair_attempts`, `topic_redirect_to_self`.

Unique D marker ids Track A must produce or list in `unavailable`: `wwbp.openness`, `long_word_share`, `empath_intellect`, `wwbp.conscientiousness`, `swear_rate`, `wwbp.extraversion`, `pos_emotion_rate`, `social_word_rate`, `initiation_share`, `wwbp.agreeableness`, `anger_swear_rate`, `we_rate`, `wwbp.neuroticism`, `neg_emotion_rate`, `anxiety_word_rate`, `i_rate`, `vader_compound`, `absolutist_rate`, `tentative_worry_rate`, `substance_first_person_rate`, `gambling_first_person_rate`, `craving_phrase_rate`, `late_night_episode_share`, `anger_rage_rate`, `achievement_work_rate`, `you_rate`, `tentative_anxiety_rate`, `double_text_rate`.

Anchors file format (`data/exp_anchors_v1.json`): `{"anchors_version": "exp-anchors-v1", "draft": true, "note": …, "markers": {marker_id: {"lo", "hi", "anchor_source", "note"}}}`; WWBP markers use `{"c", "k", …}` (logistic squash). Anchors are keyed by marker id and shared across dimensions. Track C fills real values and removes `draft`.

## 5. Intermediate dataclasses and signatures

Defined in `contract.py`: `Citation`, `Dimension`, `Marker` (frozen), `MarkerObservation(marker_id, speaker, episode_id, num, den, week)`, `ExpQuote(marker_id, speaker, episode_id, msg_idx, start, end)`, `DeterministicResult(observations, words, episodes_with_speaker, unavailable)`, `ExpLLMStats(llm_calls, llm_retries, invalid_outputs, cache_hits, cache_misses, dropped_quotes)`, `ExpLLMResult(status, reason, observations, agreeing_episodes, agreement_rate, unstable_items, holistic, quotes, stats)`.

Pooling: `x = Σnum / Σden` per speaker. Rates: num = count, den = words, reported ×100 as "% of words". LLM items: num = agreed mean of the two runs, den = 1, marker id `llm.<item>`. Episode shares: num 0/1, den 1. Valence: num = sum of message compounds, den = messages. `double_text_rate`: num = double texts, den = messages, ×100 as "% of messages". `ExpQuote.msg_idx` indexes `Episode.msgs`; `start/end` are character offsets in that message.

```python
deterministic.compute_deterministic(episodes, speakers) -> DeterministicResult                       # Track A
llm_exp.score_llm(provider, selected, store, *, speakers, budget, progress=None, holistic=True)
    -> ExpLLMResult                                                                                # Track B
mock_exp.complete(system, user, run_idx=0) -> llm.LLMResult                                        # Track B
scoring.build_section(det, llm, episodes, week_order, *, speakers, llm_ran, seed=1017) -> dict     # Track C
scoring.not_run_section(reason, speakers=("me",)) -> dict                                          # Track C
section.run_experimental(*, episodes, selection, provider, store, llm_ran, speakers, week_order,
                         progress) -> Tuple[dict, ExpLLMStats]                                     # Track D
safety.lint_experimental(text) -> List[str]                                                        # Track D
```
All are `NotImplementedError` stubs on `exp/contract`. `MockProvider.complete()` sends any system prompt starting with `TASK: EXPERIMENTAL` or `TASK: HOLISTIC` to `mock_exp.complete(system, user, run_idx)` and returns its `LLMResult` unchanged (the `malformed_once`/`always_malformed` test modes still apply first).

## 6. Scoring rules (Track C)

Exactly plan §3.5: pooled value; sub-score `clamp((x − lo)/(hi − lo), 0, 1)` flipped for ↓; R/H anchors 1–5; WWBP logistic `1/(1+e^(−(x−c)/k))`; caps with one-pass proportional redistribution then renormalize; `score = round(100·Σ w s / Σ w)` over markers with data, needing ≥ 2 markers with data including ≥ 1 D, else `insufficient_data`; band = seeded bootstrap over episodes (200, seed 1017), 10th–90th, widened by the evidence penalty and +10 without LLM, clamped 0–100; gating per speaker (< 20 agreeing episodes when the LLM ran, < 20 episodes with that speaker otherwise, or < 1,500 words → `insufficient_data`); confidence `low` unless moderate evidence and ≥ 30 episodes, ≥ 3,000 words and agreement ≥ 0.8 → `medium`; never `high`; trend per ISO week with ≥ 300 words and ≥ 3 episodes, else `score: null` with reason; contributions list every registry marker of the dimension.

Contribution conventions: `weight` is the effective share after caps among markers with data (sums to 1 for an `ok` speaker); markers with status `no_data` or `not_run` have `weight: 0`, `value: null`, `sub_score: null`, `quote_ids: []`. Contributions are sorted by effective weight, descending. A speaker's `quote_ids` is the union of its contributions' quote ids.

## 7. Report schema 1.1.0 (additive)

- `schema_version`: enum `["1.0.0", "1.1.0"]`; `config.SCHEMA_VERSION` is `1.1.0`. Reports without `experimental_scores` stay valid (both existing samples are tested).
- Optional top-level `experimental_scores` → `$defs/experimentalScores`; new `$defs`: `expDimension`, `expCitation`, `expSpeakerScore`, `expContribution`, `expTrendPoint`, `expQuote`.
- `dimensions` uses `prefixItems`: exactly 12, in registry order, with `key`, `label`, `family`, `evidence_strength` and `evidence_note` pinned as consts; `low`-max dimensions only allow `confidence` `low`/null.
  - *Integration fix (exp/integration):* on those 7 dimensions `per_speaker.other` is `oneOf [null, {confidence: low|null}]`; the second branch had no `type`, so `other: null` matched both branches and failed `oneOf`. The branch now has `"type": "object"`. No field, enum or meaning changed: `other` is an `expSpeakerScore` object, or `null` when the other person was not scored, as plan §4 already said.
- `expSpeakerScore`: when `status` is `ok`, `score` is an integer, `band` an object and `confidence` `low|medium`; otherwise all three are null and `reason` is a string.
- Constant section strings: `banner`, `title`, `scale_note`, `footer_support`, `how_it_works` (exact `strings.py` values), `scoring_version`, `prompt_versions`, `anchors_version`, `thresholds`.
- `run_meta` (all optional): `experimental_opt_in` (bool), `score_other_opt_in` (bool), `experimental_scoring_version` (string|null), `experimental_prompt_versions` ({episode, holistic}|null), `experimental_llm_calls` (int), `experimental_cache_hits` (int). rich-demo's `run_meta.provider_note` is kept.
- Forbidden keys anywhere under the section: `percentile`, `t_score`, `norm`, `level`, `category`, `label_high`, `cutoff`.
- Experimental quotes live only in `experimental_scores.quotes` (ids `xq_001`…); never in top-level `quotes[]`, never cited by synthesis.

Example dimension (trimmed from the sample):

```json
{
 "key": "neuroticism",
 "label": "Neuroticism (experimental language index)",
 "family": "big_five",
 "evidence_strength": "moderate",
 "evidence_note": "Language markers associated in research with neuroticism; evidence: moderate",
 "citations": [
  {
   "short": "Park et al. 2015",
   "doi": "10.1037/pspp0000020"
  },
  {
   "short": "Azucar, Marengo & Settanni 2018",
   "doi": "10.1016/j.paid.2017.12.018"
  },
  {
   "short": "Yarkoni 2010",
   "doi": "10.1016/j.jrp.2010.04.001"
  },
  {
   "short": "Tackman et al. 2019",
   "doi": "10.1037/pspp0000187"
  }
 ],
 "per_speaker": {
  "me": {
   "status": "ok",
   "reason": null,
   "score": 65,
   "band": {
    "lo": 50,
    "hi": 80
   },
   "confidence": "medium",
   "n_episodes": 36,
   "n_words": 13649,
   "contributions": [
    {
     "marker_key": "wwbp.neuroticism",
     "label": "WWBP weighted word list for this dimension",
     "source": "D",
     "direction": "up",
     "weight": 0.321,
     "value": 0.661,
     "unit": "lexicon units per 100 words",
     "sub_score": 0.659,
     "anchor_source": "engineering anchor",
     "status": "ok",
     "quote_ids": []
    },
    {
     "marker_key": "holistic.neuroticism",
     "label": "Overall AI rating for this dimension",
     "source": "H",
     "direction": "up",
     "weight": 0.266,
     "value": 3.704,
     "unit": "1-5 rubric",
     "sub_score": 0.676,
     "anchor_source": "rubric scale",
     "status": "ok",
     "quote_ids": []
    }
   ],
   "trend": [
    {
     "week": "2025-W32",
     "score": 63,
     "n_episodes": 7,
     "n_words": 470,
     "reason": null
    },
    {
     "week": "2025-W33",
     "score": 68,
     "n_episodes": 8,
     "n_words": 647,
     "reason": null
    }
   ],
   "quote_ids": [
    "xq_001"
   ]
  },
  "other": {
   "status": "ok",
   "reason": null,
   "score": 43,
   "band": {
    "lo": 31,
    "hi": 55
   },
   "confidence": "low",
   "n_episodes": 33,
   "n_words": 13146,
   "contributions": [
    {
     "marker_key": "wwbp.neuroticism",
     "label": "WWBP weighted word list for this dimension",
     "source": "D",
     "direction": "up",
     "weight": 0.321,
     "value": -0.888,
     "unit": "lexicon units per 100 words",
     "sub_score": 0.292,
     "anchor_source": "engineering anchor",
     "status": "ok",
     "quote_ids": []
    },
    {
     "marker_key": "holistic.neuroticism",
     "label": "Overall AI rating for this dimension",
     "source": "H",
     "direction": "up",
     "weight": 0.266,
     "value": 2.685,
     "unit": "1-5 rubric",
     "sub_score": 0.421,
     "anchor_source": "rubric scale",
     "status": "ok",
     "quote_ids": []
    }
   ],
   "trend": [
    {
     "week": "2025-W32",
     "score": 48,
     "n_episodes": 7,
     "n_words": 435,
     "reason": null
    },
    {
     "week": "2025-W33",
     "score": 37,
     "n_episodes": 8,
     "n_words": 638,
     "reason": null
    }
   ],
   "quote_ids": []
  }
 }
}
```

Example `insufficient_data` speaker (trimmed):

```json
{
 "status": "insufficient_data",
 "reason": "fewer than 2 markers with data, or no word-count marker with data",
 "score": null,
 "band": null,
 "confidence": null,
 "n_episodes": 33,
 "n_words": 13146,
 "contributions": [
  {
   "marker_key": "we_rate",
   "label": "We/us/our words",
   "source": "D",
   "direction": "down",
   "weight": 1.0,
   "value": 1.335,
   "unit": "% of words",
   "sub_score": 0.369,
   "anchor_source": "engineering anchor",
   "status": "ok",
   "quote_ids": []
  }
 ],
 "trend": [],
 "quote_ids": []
}
```

Example `run_meta` additions:

```json
{
 "experimental_opt_in": true,
 "score_other_opt_in": true,
 "experimental_scoring_version": "exp-scores-v1",
 "experimental_prompt_versions": {
  "episode": "traits-exp-v1",
  "holistic": "exp-holistic-v1"
 },
 "experimental_llm_calls": 84,
 "experimental_cache_hits": 0
}
```

## 8. API, CLI and config surface (Track D implements)

**POST /analyses** adds:
- `experimental_scores: bool` — default `false`; default `true` when `conversation_id` is `"demo"`.
- `score_other: bool` — default `false`; default `true` for the demo. `score_other: true` with `experimental_scores: false` → **422 `EXPERIMENTAL_CONSENT_REQUIRED`** with message `strings.CONSENT_ERROR_MESSAGE`.
- `experimental_opt_in_text` / `score_other_opt_in_text`: echo of the exact consent strings shown; a mismatch → 422 `EXPERIMENTAL_CONSENT_REQUIRED` (`strings.CONSENT_MISMATCH_MESSAGE`). The demo does not require the echo.
- Without `llm_opt_in`: deterministic markers only; R and H contributions `not_run`; band +10.
- Non-demo default (no consent): section present with `status: not_run`, reason `"not requested"`, no experimental work done.
- Progress events add stage `experimental` with `done/total` = experimental LLM calls.
- A failure inside the stage never fails the analysis: section `status: failed`, reason `strings.REASON_FAILED`.

**GET /config** adds: `experimental_opt_in_text`, `score_other_opt_in_text`, `experimental_banner`, `experimental_footer_support`, `experimental_scale_note`, `experimental_how_it_works`, `experimental_enabled` (false when `PSYCHOSIGHT_EXPERIMENTAL=0`), `experimental_dimensions` (list of `{key, label, family, evidence_strength}` in registry order). The frontend renders these verbatim.

**CLI:** `analyze --experimental-scores [--score-other]`; `--demo` implies both unless `--no-experimental-scores` (also turns off other). `--score-other` without `--experimental-scores` exits 2 with `EXPERIMENTAL_CONSENT_REQUIRED`.

**errors.py:** add `EXPERIMENTAL_CONSENT_REQUIRED` (422).

## 9. Fixed strings (`strings.py`)

- `TITLE`: "Experimental scores"
- `BANNER`: "Experimental, not validated. These scores are not a diagnosis, not a personality test and not a measure of who anyone is. They come from word counts and AI ratings of this one conversation and can easily be wrong."
- `SCALE_NOTE`: "0–100 experimental index. 50 is the midpoint of fixed reference points, not an average person. The shaded band shows how uncertain the number is."
- `EXPERIMENTAL_CONSENT`: "Show experimental personality and well-being language scores. These are 0–100 numbers built from word counts and AI ratings. They are not validated and are not a diagnosis. With AI scoring on, the same excerpts already selected are sent to DeepSeek again with extra questions."
- `SCORE_OTHER_CONSENT`: "Also score the other person. They have not agreed to be scored. Their scores are an experimental reading of their messages in this conversation only, stay on this computer, and should not be shared or used to judge them."
- `FOOTER_SUPPORT`: "If anything in this conversation is weighing on you, consider talking with someone you trust or a licensed professional."
- `INSUFFICIENT_DATA_TEXT`: "Not enough data (needs 20 episodes and 1,500 words)"
- `REASON_NOT_REQUESTED`: "not requested"
- `REASON_DISABLED`: "disabled by configuration"
- `REASON_FAILED`: "Experimental scores could not be computed for this run."
- `REASON_LLM_NOT_RUN`: "AI scoring was not run for this report"
- `REASON_WWBP_MISSING`: "wwbp lexicon not installed"
- `REASON_TOO_FEW_MARKERS`: "fewer than 2 markers with data, or no word-count marker with data"
- `REASON_TOO_FEW_EPISODES`: "fewer than 20 episodes for this person"
- `REASON_TOO_FEW_WORDS`: "fewer than 1,500 words for this person"
- `REASON_TREND_THIN_WEEK`: "fewer than 300 words or 3 episodes this week"
- `LINT_FALLBACK`: "Not shown (wording check)"
- `CONSENT_ERROR_MESSAGE`: "Scoring the other person requires the experimental scores consent."
- `CONSENT_MISMATCH_MESSAGE`: "The experimental consent text does not match the current text from GET /config."
- `HOW_IT_WORKS`: the plain-English validity statement (design v2 §1), paragraphs separated by blank lines:

> These numbers come from word counts and AI ratings of text messages. The research behind them looked at essays, Facebook posts, blogs and forums, mostly from large groups of people. Nobody has tested these formulas on iMessage conversations.
>
> The best published language-based personality models are modest. Agreement with self-report questionnaires is around r = .3 to .4 (Park et al. 2015; Azucar et al. 2018), and AI models asked directly come in around r = .29 (Peters & Matz 2024). Two people with the same true trait can easily get very different scores.
>
> Narcissism, attachment and addiction language have much weaker or exploratory evidence. Some popular ideas have failed outright: saying "I" a lot is not linked to narcissism (Carey et al. 2015, r = .01).
>
> One conversation reflects the relationship and the moment as much as the person. Your score with one person and your score with another can differ.
>
> The 0–100 scale is our own construction. 50 is the midpoint of fixed reference anchors. It is not an average person, and nothing on the scale is a dividing line.
>
> People tend to find vague personality feedback accurate (the Barnum effect, Forer 1949). Treat these scores as conversation starters, not facts.

## 10. Wording lint (`safety.py`)

- `EXP_ALLOW_LIST`: exact constants from `strings.ALLOW_LIST_CONSTANTS` (title, banner, scale note, footer, both consents, how-it-works, 12 labels, 12 evidence notes). Track B appends the holistic prompt. Applies only to strings under `experimental_scores` and to `exp-holistic-v1`.
- `EXP_BANNED` (inside the section, after stripping allow-listed constants): `diagnos`, `disorder`, `clinical`, `suicid`, `self-harm`, `relapse`, `t-score`, `percentile`, `cutoff`, `elevation`, `symptom`, `patholog`, "you have/are (a/an) narcissis|depress|addict|neurotic|anxious", `addict(s|ed)` as a verdict, `at risk`, high/low within 20 characters of score/index/number, `above/below average`.
- `lint_experimental(text) -> List[str]` (Track D): returns matching `EXP_BANNED` patterns; a hit replaces the string with `LINT_FALLBACK` and logs only the rule id.
- Global lint (`safety.lint`, `BANNED`) is unchanged: trait and condition words stay out of everything outside the section, its constants and the holistic prompt. `traits-exp-v1` is linted with the full global banned list.
