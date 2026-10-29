# PsychoSight Lite: Experimental Scores (design v2)

Owner: PS Backend Engineer. Status: draft for Siho and PM review. Date: 2026-10-28.
Supersedes `EXPERIMENTAL_TRAITS_DESIGN.md` (v1, kept for history). No code has been written and the repo is untouched.

## 0. What changed from v1 (Siho's decisions)
| # | Decision | Effect on design |
|---|---|---|
| 1 | Show an actual number | Each dimension gets a **0–100 experimental index**, an uncertainty band and a weekly trend. It has no cutoffs, no percentiles and no diagnostic wording. |
| 2 | Both sides scorable | "Other" scoring sits behind a **second explicit consent**. |
| 3 | Big Five plus more | Adds O, C, E, A, N, narcissism-related, depression-related, addictive-tendency language, anxiety-related, anger/hostility and attachment-related (anxious and avoidant). Each one carries an evidence-strength label. |
| 4 | Thresholds | At least 20 agreeing episodes and at least 1,500 words **per scored person**. Confidence never goes above `medium`. |
| 5 | Demo shows it | The demo conversation has the section on by default, with the banner. |
| 6 | Cost | About 2× DeepSeek cost is accepted. |

Hard constraints still hold:
- Nothing is framed as a diagnosis.
- No "has depression" or "is addicted" statements.
- No suicide, self-harm or relapse flags, and no crisis-detection claims.
- Wording is "language markers associated in research with …".

## 1. Plain-English validity statement (goes in the doc and the UI "How this works")
- These numbers come from **word counts and AI ratings of text messages**. The research behind them looked at essays, Facebook posts, blogs and forums, mostly from large groups of people. **Nobody has tested these formulas on iMessage conversations.**
- **The best published language-based personality models are modest.** Self-report agreement is around **r ≈ .3–.4** (Park et al. 2015; Azucar et al. 2018 meta-analysis), and zero-shot LLMs come in around **r ≈ .29** (Peters & Matz 2024). In practice, two people with the same true trait can easily get very different scores.
- **Narcissism, attachment and addiction language have much weaker or exploratory evidence.** Some popular ideas have failed outright. Saying "I" a lot is *not* linked to narcissism (Carey et al. 2015, r = .01).
- **One conversation reflects the relationship and the moment as much as the person.** Your score with your mom and your score with your roommate can differ.
- **The 0–100 scale is our own construction.** 50 is the midpoint of fixed reference anchors. It is **not** "average person", and nothing on the scale is a cutoff.
- People tend to find vague personality feedback accurate (the Barnum effect, Forer 1949). Treat the scores as conversation starters, not facts.

## 2. What the three project papers say about scoring
- **Architecture spec, Stage 5:** maps latent vectors to **T-scores (μ = 50, σ = 10)** with a "Clinical Elevation ≥ 65", covering Big Five (NEO-PI-3), HiTOP/PID-5, narcissism and UPPS-P modules. It gives **no formulas, weights or training data** for getting there. The Stage 2 Pathway B rubric items (boomeranging, defensive externalization, oversensitivity, UPPS-P urgency) are the only concrete recipe.
- **Audit:** rates T-score z-scoring, the ≥ 65 elevation and "LLM pragmatic scores → narcissism/UPPS-P/attachment" as **Critical**. It says standardization "does not establish construct equivalence". The legitimate path it gives is: feature → validated prediction model → raw predicted score → calibration against held-out self-reports (e.g., the public-domain IPIP) → validation evidence. We can't do calibration in a hackathon. **So v2 uses an explicitly *uncalibrated* experimental index, never T-scores or percentiles.**
- **Literature review:** documents the I-talk/narcissism null result, Big Five prediction from digital footprints (Kosinski 2013; Youyou 2015; Azucar 2018), LLM biases (it reports that LLMs overestimate Neuroticism and underestimate Conscientiousness and Agreeableness), and absolutist words in anxiety, depression and suicidal-ideation forums. Its UPPS-P section ties negative urgency to alcohol and substance-use disorders, but it gives **no text-based addiction scoring method**.

**Conclusion:** the papers don't explain how to compute these scores. The method below comes from my own research (section 3).

## 3. Research findings per dimension (verified sources only)
Evidence strength is graded on this scale:
- **moderate:** a cross-validated, large-sample, language-based model with r ≈ .3–.45 against self-report, in another genre.
- **small:** replicated |r| ≈ .1–.2 associations for single markers.
- **weak:** single-study, group-level or forum-classification findings.
- **very weak / exploratory:** inconsistent or unreplicated findings, or no individual-level evidence.

| Dimension | Best verified evidence | Strength |
|---|---|---|
| **Openness** | Park et al. 2015: open-vocabulary Facebook model, r = .43 vs self-report (test N = 4,824; trained on 66,732). Azucar 2018 meta: r = .39. Yarkoni 2010: openness ↔ intellectual/cultural words. | moderate (other genres) |
| **Conscientiousness** | Park 2015: r = .37. Azucar 2018: .35. LLMs underestimate it (Marengo et al. 2025). | moderate |
| **Extraversion** | Park 2015: r = .42. Azucar 2018: .40. Yarkoni 2010: positive-emotion and social words. Stachl et al. 2020: communication/social behavior was the strongest smartphone predictor class (median r = .37 for domains). | moderate |
| **Agreeableness** | Park 2015: r = .35. Azucar 2018: .29. Yarkoni 2010: positively linked to we, family and positive emotion; negatively linked to anger words and swearing. | moderate |
| **Neuroticism** | Park 2015: r = .35. Azucar 2018: .33. Yarkoni 2010: negative-emotion, anxiety and sadness words. Tackman 2019: the I-talk link "largely reflects … negative emotionality". | moderate |
| **Depression-related language** | Edwards & Holtzman 2017 meta: I-talk r = .13 (21 studies, N = 3,758). Tackman 2019: r = .10. Rude et al. 2004: more negative words (2.92% vs 1.63%) and "I" (12.17% vs 10.76%) in essays by currently depressed vs never-depressed students (n = 31 vs 67). De Choudhury et al. 2013: Twitter classifier ≈ 70% accuracy vs 64% baseline. Eichstaedt et al. 2018: Facebook language AUC 0.69 vs medical records. Al-Mosaiwi & Johnstone 2018: absolutist words elevated in depression, anxiety and suicidal-ideation *forums* (group level). | small (individual), weak for any one chat |
| **Anxiety-related language** | Yarkoni 2010: anxiety words ↔ Neuroticism. Al-Mosaiwi & Johnstone 2018: absolutist words in anxiety forums. | small/weak |
| **Anger/hostility language** | Yarkoni 2010: anger and swear words ↔ lower Agreeableness. | small |
| **Narcissism-related language** | Carey 2015: I-talk r = .01 (N = 4,811), so I-talk is **excluded**. Holtzman et al. 2019 (N = 4,941): sports, "you" and swear words slightly positive; anxiety and tentative words slightly negative; every effect \|r\| < .10. Zhang, Fingerman & Birditt 2023 (N = 281 older adults): we, achievement, work, sex and desire words (random forest, exploratory). | very weak |
| **Attachment-related (anxious / avoidant)** | Dunlop et al. 2019, SPPS (7 studies, > 1,400 observations, romantic narratives): anxious attachment ↔ more I-talk; avoidant ↔ less we-talk (holds after controlling for neuroticism). | weak (romantic narratives only) |
| **Addictive-tendency language** | Population and forum level only. Curtis et al. 2018: Twitter language predicts *county* excessive drinking (1,384 counties). Lu et al. 2019 (KDD): Reddit drug-forum language predicts later recovery-forum posting. Smith, Peters & Reiter 2024: fine-tuned BERT flags problem-gambling signs in German forum posts (precision .95, F1 .71). van der Maas & Samuel 2025: exploratory gambling-forum NLP. **No validated individual-level, text-message measure found.** | very weak / exploratory |
| LLM zero-shot Big Five (method) | Peters & Matz 2024: mean r = .29 (range .22–.33), with accuracy differing by age and gender. Marengo, Montag & Settanni 2025 (GPT-4o, Gemini 1.5 Pro, 1,214 users): underestimates A and C, overestimates E, reliable when aggregated. Piastra & Catellani 2025: GPT-4 is moderate and poor at telling when text is insufficient. | method: small–moderate, biased |

**Considered and excluded:**
- **Impulsivity/UPPS-P:** the audit rates it Critical and there is no text validation.
- **Suicide or self-harm risk:** a hard constraint.
- **Bipolar, BPD, psychopathy:** no defensible text marker for one chat, and stigmatizing.
- **Message-timing "entropy":** the audit says it is not validated.

## 4. Lexicons: what we can legally ship (offline)
| Resource | License (checked) | Use | Ship? |
|---|---|---|---|
| WWBP Big Five weighted lexicon (top-100 words per trait, from Schwartz 2013 / Park 2015 work; packaged as `bigfive` / `wwbnlp`) | **CC BY-NC-SA 3.0** (noncommercial, share-alike). The package README says its scores are "lexical association sums, **not calibrated trait predictions**". | main Big Five lexical marker | **Yes, for the non-commercial hackathon**, as a separate data file with attribution and its own license file. Remove it if PsychoSight ever goes commercial. (Siho to confirm.) |
| VADER (Hutto & Gilbert 2014) | **MIT** | message valence and negative affect. Paper: r = .881 vs human mean on tweets. | Yes (`vaderSentiment` package or vendored lexicon with MIT notice) |
| Empath (Fast et al. 2016) | **MIT**. Built-in categories ship in `categories.tsv`; `analyze()` works offline. | categories: `negative_emotion`, `sadness`, `nervousness`, `anger`, `rage`, `swearing_terms`, `alcohol`, `achievement`, `work`, `sports`, `positive_emotion`, `affection`, `friends`, `family`. Paper: r = .906 vs similar LIWC categories. | Yes (pip, or vendor the TSV subset with notice) |
| NRC Emotion Lexicon | free for **non-commercial research**; **no redistribution** | n/a | **No** (can't vendor). Optional user download only. |
| LIWC-22 | proprietary EULA; dictionaries can't be shared | n/a | **No.** Use small custom lists instead. |
| Custom lists (we write them, MIT) | ours | pronouns (existing), tentative/hedge, worry, absolutist (existing 19 words), substance terms, gambling terms, craving/urge phrases, achievement/status, second-person | Yes |

All scoring stays offline. Only the LLM items use the network, and only with opt-in.

## 5. Score computation (defensible as possible, still experimental)
**Per scored person (me, or other with consent), per dimension:**

1. **Marker values.** Computed over the person's messages in analyzed episodes:
   - lexicon rates (% of words);
   - WWBP lexical sum per 100 words;
   - VADER mean compound;
   - rubric item means (agreed pairs only, 1–5);
   - optionally the holistic LLM rating (1–5, mean of 2 runs, only if the runs agree within 1).
2. **Sub-score s_m ∈ [0, 1]** via **fixed, versioned anchors** (`exp_anchors_v1.json`): `s = clamp((x − lo)/(hi − lo))`, flipped when the direction is negative.
   - Rubric and holistic items: lo = 1, hi = 5.
   - Where a published group contrast exists, use it as the anchor pair and record the source. Example: Rude 2004 negative words 1.63% → 2.92%.
   - Otherwise, use team-chosen **engineering anchors**, labeled as such. WWBP sums use a fixed logistic squash.
   - Anchors are **never fitted to the user's own data or to population norms**.
3. **Weights from evidence.** `w_m` = the verified effect size where one exists (e.g., WWBP model ≈ the Park 2015 convergent r for that trait; LLM holistic .29; I-talk → depression .13), else a floor of .05 for unvalidated rubric items. Each marker's **direction follows the published sign**.
   - The holistic LLM marker is capped at 40% of total weight (Peters & Matz and Marengo report bias).
   - Each rubric item is capped at 25%.
4. **Index:** `score = round(100 · Σ w_m s_m / Σ w_m)` over markers with data. It needs at least 2 markers with data, including at least 1 deterministic marker, otherwise `insufficient_data`.
5. **Uncertainty band:** a seeded bootstrap over episodes (200 resamples, seed 1017), reported as the **10th–90th percentile**. It is then widened by an evidence penalty: moderate ±5, small ±10, weak ±15, very weak ±20, clamped to 0–100. The UI always shows the band next to the number.
6. **Confidence:**
   - `insufficient_data` below 20 agreeing episodes or 1,500 words for that person.
   - `low` by default.
   - `medium` only if there are ≥ 30 episodes, ≥ 3,000 words and rubric agreement ≥ 0.8, **and** the evidence strength is moderate.
   - **Never `high`.** Weak or very weak dimensions are always `low`.
7. **Trend:** the same formula per ISO week for weeks with ≥ 300 words and ≥ 3 episodes for that person, otherwise `null` with a reason. Shown as a line, with no threshold lines.
8. **Contributions:** each marker reports value, sub-score, weight and direction, so the UI can show *why* the number is what it is.

**Marker map** (D = deterministic, R = LLM rubric item, H = holistic LLM; ↑ raises the index, ↓ lowers it):

| Dimension | Markers |
|---|---|
| Openness | D WWBP-O ↑; D long-word share ↑; D Empath `art`/`reading`/`philosophy` ↑; H openness ↑ |
| Conscientiousness | D WWBP-C ↑; D swear ↓; R `follows_through_on_plans` (new) ↑; H ↑ |
| Extraversion | D WWBP-E ↑; D positive-emotion (Empath/VADER) ↑; D social words ↑; D initiation share ↑ (behavioral, unvalidated weight); H ↑ |
| Agreeableness | D WWBP-A ↑; D anger/swear ↓; D we-rate ↑; R `validates_feelings` ↑; R `assigns_fault_to_other` ↓; R `escalating_language` ↓; R `repair_attempts` ↑; H ↑ |
| Neuroticism | D WWBP-N ↑; D negative emotion ↑; D anxiety/nervousness ↑; D I-rate ↑ (.10); R `expressed_worry` ↑; R `reassurance_seeking` ↑; H ↑ |
| Depression-related language | D I-rate ↑ (.13); D negative-valence words ↑ (Rude anchors); D VADER compound ↓; D absolutist rate ↑ (group-level, weight .05); R `hopeless_or_low_energy_wording` ↑; R `negative_self_evaluation` ↑ |
| Anxiety-related language | D anxiety/nervousness words ↑; D tentative/worry words ↑; D absolutist ↑ (.05); R `expressed_worry` ↑; R `reassurance_seeking` ↑ |
| Anger/hostility language | D Empath anger + rage ↑; D swear ↑; R `escalating_language` ↑; R `assigns_fault_to_other` ↑ |
| Narcissism-related language | D we-rate ↑; D achievement/work words ↑; D "you" rate ↑; D tentative/anxiety ↓ (all \|r\| < .10, so weight .05–.08); R `topic_redirect_to_self` ↑; R `superiority_or_entitlement_phrasing` ↑; R `validates_feelings` ↓. **No I-talk.** |
| Anxious-attachment-related | D I-rate ↑ (Dunlop); R `reassurance_seeking` ↑; R `worry_about_the_relationship` ↑; D double-text rate ↑ (unvalidated, .05) |
| Avoidant-attachment-related | D we-rate ↓ (Dunlop); R `emotional_disclosure` ↓; R `deflects_closeness` ↑ |
| Addictive-tendency language | D substance terms ↑; D gambling terms ↑; D craving/urge phrases ↑; D late-night episode share ↑ (unvalidated, .05); R `urge_or_loss_of_control_wording` ↑; R `using_to_cope_wording` ↑. *Mentioning a beer is not addiction*, so terms count only in first-person usage context (R items carry most of the weight), and the band penalty is ±20. |

## 6. LLM layer
- **Episode prompt `exp-v1`.**
  - Covers ~12 behavior-only items: the new ones above plus reused `rubric-v1` items, read from the existing cache rather than re-scored.
  - When `score_other` is on, **one call per episode returns item scores for both speakers** (`{"me": {...}, "other": {...}}`), so calls don't double again.
  - Same mechanics as `rubric-v1`: two runs, |Δ| ≤ 1 rule, agreement ≥ 0.7, strict JSON with one retry, injection-safe data block, reasoning discarded.
  - Quotes must be verbatim **and from the speaker being scored** (`locate_quote(speaker=…)`).
  - The prompt contains **no trait or diagnostic words**.
- **Holistic prompt `exp-holistic-v1` (Big Five only).**
  - Two runs per scored person.
  - Input: up to 3,000 words of that person's messages, taken **only from the already-selected episodes**, so no new text leaves the machine. The other side is included only as minimal context labels.
  - It asks for 1–5 ratings on the five domains, using IPIP-style adjective anchors written by us (not copied from any instrument).
  - This is the only prompt allowed to name traits, under a scoped lint exception.
- **Budget.**
  - Experimental calls: ≤ 40 episodes × 2 runs = 80, plus ≤ 4 holistic. With retries, a separate cap of `EXP_MAX_LLM_CALLS = 110`, so the main rubric's 200 is never touched.
  - Rough cost: about 2× the current scoring tokens and time (Siho accepted this). Concurrency stays at 8.
- **Mock provider.** Deterministic fixtures for both prompts, so the demo runs offline.

## 7. Report schema 1.1.0 (additive)
The top level needs an explicit optional `experimental_scores` property, because the schema has `additionalProperties: false`.
```
experimental_scores?: {
  status: ok|not_run|insufficient_data|failed, reason,
  banner (const), title (const), scale_note (const), footer_support (const), how_it_works (const),
  scoring_version: "exp-scores-v1", prompt_versions{episode, holistic}, anchors_version,
  speakers_scored: ["me"] | ["me","other"],
  thresholds{min_episodes:20, min_words:1500, max_confidence:"medium"},
  dimensions: [{
    key, label (const), family: big_five|wellbeing_language|interpersonal,
    evidence_strength: moderate|small|weak|very_weak, evidence_note (const), citations[{short, doi}],
    per_speaker: {
      me:    {status, reason, score: 0-100|null, band:{lo,hi}|null, confidence: low|medium|null,
              n_episodes, n_words, contributions:[{marker_key, label, source: D|R|H, direction: up|down,
              weight, value, unit, sub_score, anchor_source}], trend:[{week, score|null, n_episodes, reason?}],
              quote_ids[]},
      other: {...same...} | null
    }
  }],
  quotes: [quote]   // separate from top-level quotes; never cited by synthesis
}
```
**`run_meta` additions:**
- `experimental_opt_in`
- `score_other_opt_in`
- `experimental_scoring_version`
- `experimental_prompt_versions`
- `experimental_llm_calls`
- `experimental_cache_hits`

**Forbidden keys:** `percentile`, `t_score`, `norm`, `level`, `category`, `label_high`, `cutoff`. A schema test enforces this.

## 8. API, CLI and config
**POST /analyses** gains:
- `experimental_scores` (bool, default `false`; **default `true` for `conversation_id:"demo"`**).
- `score_other` (bool, default `false`; requires `experimental_scores:true`, else `422 INVALID_REQUEST`; default `true` for the demo, since its people are synthetic).

Behavior:
- Without `llm_opt_in`, the section still runs **deterministic-only markers**. R and H markers are listed as `not_run`, and the index is computed from D markers with the band widened by +10.

**CLI:** `analyze --experimental-scores [--score-other]`. `--demo` implies both unless `--no-experimental-scores` is passed.

**GET /config** gains `experimental_opt_in_text`, `score_other_opt_in_text`, `experimental_banner`, `experimental_footer_support` and `experimental_scale_note`. The frontend renders all of these verbatim.

**Proposed fixed strings:**
- **Banner:** "Experimental, not validated. These scores are not a diagnosis, not a personality test and not a measure of who anyone is. They come from word counts and AI ratings of this one conversation and can easily be wrong."
- **Scale note:** "0–100 experimental index. 50 is the midpoint of fixed reference points, not an average person. The shaded band shows how uncertain the number is."
- **Experimental consent:** "Show experimental personality and well-being language scores. These are 0–100 numbers built from word counts and AI ratings. They are not validated and are not a diagnosis. With AI scoring on, the same excerpts already selected are sent to DeepSeek again with extra questions."
- **Other-person consent:** "Also score the other person. They have not agreed to be scored. Their scores are an experimental reading of their messages in this conversation only, stay on this computer, and should not be shared or used to judge them."
- **Footer (support):** "If anything in this conversation is weighing on you, consider talking with someone you trust or a licensed professional." The footer always shows; it is never triggered by a score.

## 9. Frontend contract (PR #3)
- **Checkboxes:** two, below the existing AI opt-in. "Other" is disabled until "experimental" is checked. Both are pre-checked only for the demo.
- **Card:** one separate **collapsed** card at the bottom, titled "Experimental scores". The banner is visible even when collapsed.
- **Charts:**
  - Big Five as **horizontal bars** (or a radar, Big Five only) with the band shaded.
  - Other dimensions as bars grouped under "Well-being language" and "Interpersonal language".
  - Me and other shown side by side when present.
  - Neutral single color. No red/green, gauges, threshold lines or "high/low" text.
- **Per dimension:** the number, the band, the confidence chip, an evidence-strength chip, "based on n episodes / n words", an expandable "Why this number" list of contributions with quotes, and a trend sparkline.
- **States:** `insufficient_data` shows "Not enough data (needs 20 episodes and 1,500 words)" instead of a number.
- **Footer:** the support line plus a "How this works" link.
- **Separation:** never placed inside or beside Observations. No share or export button for this card.

## 10. Wording and lint changes (`safety.py`)
- **New `EXPERIMENTAL_ALLOW_LIST`:** exact constants only. Covers dimension labels (e.g., "Neuroticism (experimental language index)", "Depression-related language markers", "Narcissism-related language markers", "Anxious-attachment-related language", "Addictive-tendency language markers"), banner, scale note, footer, evidence notes and how-it-works text. It applies **only** to strings under `experimental_scores` and to `exp-holistic-v1`.
- **Still banned inside the section:** `diagnos` (except in the banner), `disorder`, `clinical`, `suicid`, `self-harm`, `relapse`, `t-score`, `percentile`, `cutoff`, `elevation`, `symptom`, `patholog`.
- **New patterns:** `\byou (have|are) (a |an )?(narcissis|depress|addict|neurotic|anxious)`, `\baddict(s|ed)?\b` as a noun or verdict, `\bat risk\b`, `\bhigh\b|\blow\b` next to a score, and `\babove|below average\b`.
- **Global lint unchanged:** a test asserts trait and condition words appear nowhere outside the section, its prompt and its constants.
- **Prompt rule:** the episode prompt `exp-v1` is linted with the full banned list.

## 11. Privacy
- **Same DeepSeek opt-in plus two new consents.** The holistic call resends text from the same selected episodes only.
- **Other-person data:** scores and quotes stay in the local report. DELETE /analyses removes them.
- **No new logging.**
- **Demo:** synthetic people, so no third-party concern.

## 12. Tests
1. **Scoring unit tests:** anchors and direction flips, weights normalization, caps (H ≤ 40%, R ≤ 25%), ≥ 2-marker rule, determinism of the seeded bootstrap.
2. **Thresholds:**
   - 19 episodes or 1,499 words gives `insufficient_data`, per speaker independently.
   - Confidence is never `high`.
   - Weak and very weak dimensions are always `low`.
3. **Planted-marker synthetic tests:** extend the demo so "me" has worry/negative words and "other" has anger/swear words. Each planted dimension's score must move in the expected direction against a neutral control conversation.
4. **Lint:** scoped allow-list, forbidden keys, no condition words outside the section, prompt lint, and a "you are/have …" regex on all section strings.
5. **Consent and API:**
   - `score_other` without experimental gives 422.
   - Default non-demo gives `not_run`.
   - Demo defaults on.
   - No LLM opt-in gives D-only with R and H `not_run`.
6. **Quotes:** verbatim and speaker-matched. Experimental quotes never appear in top-level `quotes[]` or observations.
7. **Schema:** 1.1.0 samples (demo full, demo deterministic, real-shape fixture) validate. Reports without the section still validate.
8. **Licenses:** a test that the WWBP data file ships with its license file and attribution, and that no NRC or LIWC data is in the repo.
9. **Offline:** the full demo runs with the network disabled (mock provider).

## 13. Parallel implementation plan (hackathon)
**Step 0, contract freeze (15 min, lead):** marker keys, the `MarkerValue` intermediate dataclass, the anchors file format and the schema skeleton. All tracks start after this.

| Track | Owner (agent) | Work | Effort |
|---|---|---|---|
| A. Lexicons and deterministic features | agent 1 | Vendor WWBP (with license), VADER and the Empath subset; write custom lists (tentative, worry, substance, gambling, craving, achievement, second-person); compute per-speaker, per-episode and per-week rates | 60–75 min |
| B. Rubric and LLM | agent 2 | `exp-v1` both-speaker prompt and validator, `exp-holistic-v1`, reuse of rubric-v1 cache, separate budget, mock fixtures | 60–75 min |
| C. Scoring and aggregation | agent 3 | `exp_anchors_v1.json`, weights, sub-scores, caps, index, bootstrap band and evidence penalty, confidence, trend, contributions | 60–75 min |
| D. Schema, API, CLI and config | agent 4 | schema 1.1.0, request fields, demo defaults, consents and config strings, run_meta, error cases | 45 min |
| E. Docs, tests and lint | agent 5 | `safety.py` scoped allow-list, test suite above, `docs/EXPERIMENTAL_SCORES.md` (methods, citations, validity statement), sample reports | 60–75 min |
| F. Frontend card | Frontend Engineer | checkboxes, collapsed card, bars and band, contributions drawer, footer | 60–90 min |

- **Timing:** about 2 hours wall-clock with 5 backend agents in parallel, and about 6 agent-hours total.
- **Integration:** a final 20-minute merge pass by the lead, then PR to PS Merge Engineer.
- **Order of merge:** D (schema) first, then A, B and C, then E, then F.

## 14. Open questions for Siho
1. **WWBP lexicon license:** it is CC BY-NC-SA 3.0 (noncommercial, share-alike). OK to vendor it for the hackathon, given it must come out if the project ever goes commercial? The alternative is our own small lists only, with weaker Big Five markers.
2. **Holistic LLM Big Five rating:** keep it as one marker, capped at 40%? It is the best-studied LLM method (r ≈ .29) but has known bias.
3. **Attachment dimensions:** the evidence comes from *romantic* narratives. Show them for every chat, or only when you mark a chat as romantic?
4. **Addictive-tendency language:** the evidence is very weak and term mentions are noisy (jokes, plans for drinks). Keep it with a ±20 band, or hide it until it has more R-item support?
5. **Demo "other" scoring on by default:** OK, given the people are synthetic?
6. **Label style:** "Neuroticism (experimental language index)" vs plain "Neuroticism"? I recommend the former.

## 15. Sources
### Project papers (found and read; PDFs in the PsychoSight PM agent's store, text in `/workspace/papers/`)
- Audit of the Longitudinal Computational Psychometrics App Plan
- Longitudinal Psychometric Profiling System: Architecture & Research Specification (also in Google Drive)
- Computational Psychometrics and Digital Phenotyping: A Critical Review

### Verified this session (existence plus the numbers quoted)
- **Narcissism and pronouns**
  - Carey et al. 2015, JPSP, 10.1037/pspp0000029
  - Holtzman et al. 2019, JLSP, 10.1177/0261927X19871084
  - Zhang, Fingerman & Birditt 2023, J Gerontol B, 10.1093/geronb/gbad061
- **Depression and negative emotionality**
  - Tackman et al. 2019, JPSP, 10.1037/pspp0000187
  - Edwards & Holtzman 2017, JRP, 10.1016/j.jrp.2017.02.005
  - Rude, Gortner & Pennebaker 2004, Cognition & Emotion, 10.1080/02699930441000030
  - De Choudhury et al. 2013, ICWSM, 10.1609/icwsm.v7i1.14432
  - Eichstaedt et al. 2018, PNAS, 10.1073/pnas.1802331115
  - Al-Mosaiwi & Johnstone 2018, CPS, 10.1177/2167702617747074
- **Language-based personality**
  - Yarkoni 2010, JRP, 10.1016/j.jrp.2010.04.001
  - Pennebaker & King 1999, JPSP, 10.1037/0022-3514.77.6.1296
  - Mairesse et al. 2007, JAIR, 10.1613/jair.2349
  - Schwartz et al. 2013, PLOS ONE, 10.1371/journal.pone.0073791
  - Park et al. 2015, JPSP, 10.1037/pspp0000020
- **Digital footprints and behavior**
  - Kosinski, Stillwell & Graepel 2013, PNAS, 10.1073/pnas.1218772110 (Openness r = .43 from Likes)
  - Youyou, Kosinski & Stillwell 2015, PNAS, 10.1073/pnas.1418680112 (r = .56 vs friends .49, from Likes)
  - Azucar, Marengo & Settanni 2018, PAID, 10.1016/j.paid.2017.12.018
  - Stachl et al. 2020, PNAS, 10.1073/pnas.1920484117
- **LLM personality inference**
  - Peters & Matz 2024, PNAS Nexus, 10.1093/pnasnexus/pgae231
  - Marengo, Montag & Settanni 2025, J Personality, 10.1111/jopy.70019
  - Piastra & Catellani 2025, Frontiers in AI (PMC11865037)
- **Attachment**
  - Dunlop et al. 2019, SPPS, 10.1177/1948550619847455
- **Substance use and gambling**
  - Lu et al. 2019, KDD, 10.1145/3292500.3330737
  - Curtis et al. 2018, PLOS ONE, 10.1371/journal.pone.0194290
  - Smith, Peters & Reiter 2024, PLOS Digital Health, 10.1371/journal.pdig.0000605
  - van der Maas & Samuel 2025, Harm Reduction J, 10.1186/s12954-025-01220-0
- **Tools and lexicons**
  - Hutto & Gilbert 2014 (VADER, MIT)
  - Fast, Chen & Bernstein 2016 (Empath, MIT)
  - NRC EmoLex terms (non-commercial, no redistribution)
  - LIWC EULA (proprietary)
  - `bigfive` / `wwbnlp` (CC BY-NC-SA 3.0)
- **Barnum effect**
  - Forer 1949, 10.1037/h0059240

### Not independently verified (cited only via the project papers, or flagged)
- Raskin & Shaw 1988 (N = 48, r = .26, per the audit)
- Krizan & Herlache 2018; Casale & Banchi 2020; Holtzman, Vazire & Mehl 2010
- The absolutist forum means (0.97% / 1.45% / 1.80%, per the audit)
- The review's claim that LLMs overestimate Neuroticism
- Kosinski 2013 substance-use prediction figures
- The exact provenance of the `bigfive` top-100 lexicon beyond its README/NOTICE attribution to WWBP
- The Marengo 2025 correlation range (abstract truncated)
