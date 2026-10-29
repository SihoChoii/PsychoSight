# Experimental scores

Optional 0–100 indexes on a PsychoSight report. They are **experimental and not validated**. They are not a diagnosis, not a personality test, and not a measure of who anyone is. A number describes word counts and AI ratings in **this one conversation**. It can easily be wrong.

The report shows this fixed banner, and the same text is the product rule for reading every figure below:

> Experimental, not validated. These scores are not a diagnosis, not a personality test and not a measure of who anyone is. They come from word counts and AI ratings of this one conversation and can easily be wrong.

Machine-readable contract: [`EXPERIMENTAL_CONTRACT.md`](EXPERIMENTAL_CONTRACT.md). Example section: [`sample_experimental_scores.json`](sample_experimental_scores.json). Design notes: [`experimental/SCORES_DESIGN_v2.md`](experimental/SCORES_DESIGN_v2.md).

## Validity

This is the "How this works" text stored on the report (`how_it_works`). It is the validity statement. Nothing in the scoring section overrides it.

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

What the project papers imply for this feature: they do not give a formula, weights, or training data that we could run on a chat. One spec describes mapping vectors to T-scores (mean 50, spread 10) and a line at 65. The audit rates that style of standardization, and the jump from language ratings to trait modules, as a critical problem: putting a number on a standard scale does not show that the number means the same thing as a questionnaire. A legitimate path would be a validated model, then calibration on held-out self-reports. This hackathon cannot do that calibration. The index here is explicitly uncalibrated. It never reports a T-score, a percentile, a norm, or a dividing line.

People also tend to accept vague personality feedback (Forer 1949, 10.1037/h0059240). Read a score as a prompt to look at the quoted messages, not as a fact about a person.

## How a number is built

Each scored person (you, and the other person only after a second consent) gets an index per dimension.

1. **Marker value.** Word-count rates pool as `x = Σ num / Σ den` over that person's episodes. Counts over words are shown ×100 as "% of words". A 1–5 AI item uses the mean of two runs that stayed within 1 point, with denominator 1. Valence uses the sum of message scores over the number of messages. Episode shares use 0/1 over 1.
2. **Sub-score.** `s = clamp((x − lo) / (hi − lo), 0, 1)`, then `s = 1 − s` when the marker's direction is down. AI items use lo = 1 and hi = 5. WWBP sums use `s = 1 / (1 + e^(−(x − c) / k))` with fixed `c` and `k`. Anchors are never fitted to this conversation or to a population.
3. **Weights.** Each marker has an evidence weight (a verified |r| where one exists, otherwise a floor of 0.05). Direction follows the published sign. After weights are normalized inside the dimension, any overall AI marker above 40% of the weight and any episode-level AI item above 25% is clipped. The excess is redistributed once, in proportion, to the uncapped markers, then the weights are normalized again.
4. **Index.** `score = round(100 · Σ w s / Σ w)` over markers that have data. A person needs at least two markers with data, including at least one word-count marker. Otherwise that person is `insufficient_data` for that dimension.
5. **Band.** Seeded bootstrap over episodes: 200 resamples, seed 1017, 10th to 90th percentile of the resampled index. The band is then widened by an evidence penalty (moderate ±5, small ±10, weak ±15, very weak ±20) and by another ±10 when AI scoring did not run. The result is clamped to 0–100. The band is the uncertainty, and it is always shown with the number.
6. **Gating, per person.** `insufficient_data` when that person has fewer than 20 agreeing episodes (AI scoring ran) or fewer than 20 episodes they wrote in (word counts only), or fewer than 1,500 words. The other person is judged separately.
7. **Confidence.** `low` unless the evidence label is moderate **and** that person has at least 30 episodes, at least 3,000 words, and AI agreement of at least 0.8, in which case `medium`. Confidence is never `high`. Dimensions whose evidence is small, weak, or very weak stay `low`.
8. **Trend.** The same index per ISO week, only for a week with at least 300 words and 3 episodes from that person. Thinner weeks are `score: null` with a reason. There is no band on a week and no threshold line.
9. **Contributions.** Every marker in the registry is listed. Markers with data carry the effective weight (they sum to 1 when the person is `ok`), the raw value, the sub-score, the direction, and up to two quote ids. Markers with no data have weight 0. The list is sorted by effective weight, descending.

Versions on the section: scoring `exp-scores-v1`, episode prompt `traits-exp-v1`, holistic prompt `exp-holistic-v1`, anchors `exp-anchors-v1`.

Word-count markers run with or without the AI opt-in. Episode items and the overall AI rating are `not_run` when AI scoring is off, and the band is widened by the extra 10 points. Experimental model calls use their own cap of 110 (`PSYCHOSIGHT_EXP_MAX_LLM_CALLS`), separate from the main rubric cap of 200. The overall AI rating sees at most 3,000 words of that person's messages, taken only from episodes already selected for the main rubric.

`PSYCHOSIGHT_EXPERIMENTAL=0` does not compute the section (`not_run`, reason "disabled by configuration"). A crash inside the section does not fail the rest of the report (`failed`, with a fixed reason and no message text).

## Anchors

Anchors live in `psychosight/experimental/data/exp_anchors_v1.json`, keyed by marker id and shared across dimensions. Each entry records `anchor_source`.

| Kind | Endpoints | Source label |
|---|---|---|
| Episode AI item and overall AI rating | 1 and 5 | `rubric scale` |
| WWBP weighted sum | logistic `c`, `k` (not a low/high pair) | `engineering anchor` unless the file names a paper |
| Negative-emotion word rate | 1.63% to 2.92% | Rude, Gortner & Pennebaker 2004 |
| I/me/my rate | 10.76% to 12.17% | Rude, Gortner & Pennebaker 2004 |
| Every other word-count marker | the file's `lo` and `hi` | `engineering anchor` |

The Rude endpoints are the group contrast in student essays: currently depressed students (n = 31) versus never-depressed students (n = 67). They are a reference pair for the scale, not a result about the person in this chat, and not a line anyone must cross. Engineering anchors are team-chosen fixed points, labeled as such, so the index can be computed when a paper does not publish a group contrast. They are not norms.

50 on the 0–100 index is the midpoint of these fixed points. It is not an average person.

## Evidence by dimension

Evidence labels in the product are `moderate`, `small`, `weak`, or `very_weak`. The grading used while reading the papers was: **moderate**, a cross-validated language model with r around .3 to .45 against self-report, in some other genre; **small**, replicated |r| around .1 to .2 for a single marker; **weak**, a single study, a group contrast, or a forum classifier; **very weak**, inconsistent, unreplicated, or no individual-level evidence. Every study below was checked for existence and for the numbers quoted. Citations that were not checked that way are omitted.

The studies are essays, Facebook posts, blogs, forums, smartphone logs, or model benchmarks. **None of them tested these formulas on iMessage.**

### Openness (`openness`) — moderate, confidence up to medium

Park et al. 2015 (10.1037/pspp0000020): open-vocabulary Facebook model, r = .43 against self-report (test N = 4,824; trained on 66,732). Azucar, Marengo & Settanni 2018 (10.1016/j.paid.2017.12.018): meta-analytic r = .39. Yarkoni 2010 (10.1016/j.jrp.2010.04.001): openness tracked with intellectual and cultural words.

Markers: WWBP list ↑ 0.43, long words (7+ letters) ↑ 0.10, art/reading/ideas words ↑ 0.10, overall AI rating ↑ 0.29.

### Conscientiousness (`conscientiousness`) — moderate, confidence up to medium

Park et al. 2015: r = .37. Azucar et al. 2018: r = .35. Marengo, Montag & Settanni 2025 (10.1111/jopy.70019; GPT-4o and Gemini 1.5 Pro, 1,214 users) found that those models underestimate conscientiousness (and agreeableness) and overestimate extraversion. That bias is why the overall AI rating is capped.

Markers: WWBP list ↑ 0.37, swear words ↓ 0.10, "follows through on plans" AI item ↑ 0.05, overall AI rating ↑ 0.29. Without the WWBP file, word-count-only mode has only the swear marker on this dimension, which is not enough to show an index (two markers are required, including one word-count marker). The AI items supply the second marker when AI scoring is on.

### Extraversion (`extraversion`) — moderate, confidence up to medium

Park et al. 2015: r = .42. Azucar et al. 2018: r = .40. Yarkoni 2010: positive-emotion words and social words. Stachl et al. 2020 (10.1073/pnas.1920484117): on smartphones, communication and social behavior was the strongest predictor class (median r = .37 across domains). That result is about phone behavior, not about a chat formula, and the initiation marker that cites it is a small behavioral weight (0.05), not a validated message score.

Markers: WWBP list ↑ 0.42, positive-emotion words ↑ 0.15, social words ↑ 0.10, share of episodes this person started ↑ 0.05, overall AI rating ↑ 0.29.

### Agreeableness (`agreeableness`) — moderate, confidence up to medium

Park et al. 2015: r = .35. Azucar et al. 2018: r = .29. Yarkoni 2010: positive links with "we", family, and positive-emotion words; negative links with anger words and swearing.

Markers: WWBP list ↑ 0.35, anger and swear words ↓ 0.15, we/us/our ↑ 0.10, and four small AI items (validates feelings ↑, puts fault on the other person ↓, escalating wording ↓, repair attempts ↑, each 0.05), overall AI rating ↑ 0.29.

### Neuroticism (`neuroticism`) — moderate, confidence up to medium

Park et al. 2015: r = .35. Azucar et al. 2018: r = .33. Yarkoni 2010: negative-emotion, anxiety, and sadness words. Tackman et al. 2019 (10.1037/pspp0000187): the link between saying "I" and depression "largely reflects … negative emotionality", which is why I/me/my is a neuroticism marker here (weight 0.10) and not a narcissism marker.

Markers: WWBP list ↑ 0.35, negative-emotion words ↑ 0.15, worry and nervousness words ↑ 0.10, I/me/my ↑ 0.10, expressed-worry AI item ↑ 0.05, reassurance-seeking AI item ↑ 0.05, overall AI rating ↑ 0.29.

### Depression-related language (`depression_language`) — small, confidence low only

This index is language associated with low mood in other studies. It is not a screen, and a chat is a weaker setting than the papers.

Edwards & Holtzman 2017 (10.1016/j.jrp.2017.02.005): I-talk meta-analysis, r = .13 (21 studies, N = 3,758). Tackman et al. 2019: r = .10. Rude, Gortner & Pennebaker 2004 (10.1080/02699930441000030): essays from currently depressed students had more negative-emotion words (2.92% vs 1.63%) and more "I" (12.17% vs 10.76%) than essays from never-depressed students (n = 31 vs 67). Those two contrasts are the anchors for those markers. Eichstaedt et al. 2018 (10.1073/pnas.1802331115): Facebook language, AUC 0.69 against medical records. De Choudhury et al. 2013 (10.1609/icwsm.v7i1.14432): a Twitter classifier around 70% accuracy against a 64% baseline. Al-Mosaiwi & Johnstone 2018 (10.1177/2167702617747074): absolutist words were higher in depression, anxiety, and suicidal-ideation **forums**, at group level. This product does not detect or flag suicidal ideation, self-harm, or crisis, and it does not turn that forum result into a score for one person. The absolutist marker's weight is the floor, 0.05.

The product evidence label is **small**. The design review called any single chat **weak** relative to those group and record studies. Confidence stays low.

Markers: I/me/my ↑ 0.13, negative-emotion words ↑ 0.10, VADER tone ↓ 0.10, absolutist words ↑ 0.05, hopeless or low-energy wording ↑ 0.05, negative statements about oneself ↑ 0.05. There is no overall AI rating on this dimension.

### Anxiety-related language (`anxiety_language`) — small, confidence low only

Yarkoni 2010: anxiety words tracked with neuroticism. Al-Mosaiwi & Johnstone 2018: absolutist words in anxiety forums (group level). The design review called this small to weak. The product label is **small**, and confidence stays low. There is no overall AI rating.

Markers: worry and nervousness words ↑ 0.10, tentative and worry words ↑ 0.08, absolutist words ↑ 0.05, expressed worry ↑ 0.05, reassurance seeking ↑ 0.05.

### Anger/hostility language (`anger_hostility_language`) — small, confidence low only

Yarkoni 2010: anger words and swear words tracked with lower agreeableness. That is a single-marker association, not a hostility questionnaire. Confidence stays low.

Markers: anger and rage words ↑ 0.12, swear words ↑ 0.10, escalating wording ↑ 0.05, putting fault on the other person ↑ 0.05.

### Narcissism-related language (`narcissism_language`) — very weak, confidence low only

Carey et al. 2015 (10.1037/pspp0000029): saying "I" a lot, r = .01 (N = 4,811). I-talk is **not** a marker here. Holtzman et al. 2019 (10.1177/0261927X19871084; N = 4,941): sports words, "you", and swear words were slightly positive, and anxiety and tentative words were slightly negative; every effect was |r| < .10. Zhang, Fingerman & Birditt 2023 (10.1093/geronb/gbad061; N = 281 older adults): "we", achievement, work, sex, and desire words in an exploratory random forest. No individual-level text-message measure with a stable effect size was found. The product label is **very weak**.

Markers (weights 0.05 to 0.06): we/us/our ↑, achievement and work words ↑, you/your ↑, tentative and anxious-sounding words ↓, plus three AI items (steers the topic to oneself ↑, superiority or entitlement phrasing ↑, validates the other person's feelings ↓).

### Anxious-attachment-related language (`attachment_anxious_language`) — very weak, confidence low only

Dunlop et al. 2019 (10.1177/1948550619847455): seven studies, more than 1,400 observations of **romantic narratives**. Anxious attachment went with more I-talk, including after neuroticism was controlled. The product still shows this index on every chat, including chats that are not romantic, and labels the evidence **very weak**. A work chat is outside the study. Confidence stays low.

Markers: I/me/my ↑ 0.08, double texts ↑ 0.05 (no published text validation; floor weight), reassurance seeking ↑ 0.05, worry about the relationship ↑ 0.05.

### Avoidant-attachment-related language (`attachment_avoidant_language`) — very weak, confidence low only

The same Dunlop et al. 2019 paper: avoidant attachment went with less we-talk in those romantic narratives, including after a neuroticism control. Same product rule as the anxious index: shown on every chat, evidence **very weak**, confidence low. In word-count-only mode this dimension has a single deterministic marker, so it stays `insufficient_data` until the AI items have data (the index needs two markers).

Markers: we/us/our ↓ 0.08, shares own feelings ↓ 0.05, deflects closeness ↑ 0.05.

### Addictive-tendency language (`addictive_language`) — very weak, confidence low only

Population and forum results only. Curtis et al. 2018 (10.1371/journal.pone.0194290): Twitter language predicted **county** excessive drinking (1,384 counties). Lu et al. 2019 (10.1145/3292500.3330737): Reddit drug-forum language predicted later posting in a recovery forum. Smith, Peters & Reiter 2024 (10.1371/journal.pdig.0000605): a fine-tuned model flagged problem-gambling signs in German forum posts (precision .95, F1 .71). van der Maas & Samuel 2025 (10.1186/s12954-025-01220-0): exploratory gambling-forum text analysis. **No validated individual-level text-message measure was found.**

A mention of a drink is not evidence about a person. Alcohol, drug, and betting words count only when an I/me/my token sits within five tokens in the same message. The evidence penalty on the band is ±20. Confidence stays low.

Markers, each at the floor weight 0.05: first-person substance words ↑, first-person betting words ↑, craving or urge phrases ↑, episodes started between 01:00 and 04:00 ↑ (no published validation), urge or loss-of-control wording ↑, using something to cope ↑.

### Overall AI rating (method, Big Five only)

Peters & Matz 2024 (10.1093/pnasnexus/pgae231): zero-shot models, mean r = .29 (range .22 to .33), with accuracy differing by age and gender. Marengo et al. 2025: the models above underestimate agreeableness and conscientiousness, overestimate extraversion, and look more stable once ratings are aggregated. A correlation range for Marengo et al. 2025 was not confirmed from the abstract and is not quoted here. Piastra & Catellani 2025 (PMC11865037): GPT-4 was moderate, and poor at telling when the text was not enough. The product treats this method as small to moderate and biased. The marker is capped at 40% of a Big Five dimension. It is not used on the other dimensions. The five adjective anchors in the prompt are written for this project and are not copied from a published instrument.

Facebook Likes models (Kosinski, Stillwell & Graepel 2013, 10.1073/pnas.1218772110, openness r = .43 from Likes; Youyou, Kosinski & Stillwell 2015, 10.1073/pnas.1418680112, r = .56 against self-report from Likes) are a different task. They are not markers here.

## Lexicons and licenses

Scoring of word lists is offline. Only the AI items use the network, and only after the existing AI opt-in.

| Resource | License | What we do |
|---|---|---|
| WWBP Big Five weighted lexicon (top words per trait from the Schwartz / Park WWBP line; package names `bigfive` / `wwbnlp`) | CC BY-NC-SA 3.0, noncommercial, share-alike | One removable directory, `psychosight/experimental/wwbp/`, with `LICENSE-CC-BY-NC-SA-3.0.txt` and `NOTICE.md`. Hackathon and other non-commercial use only. Remove the directory before any commercial use. The package describes its scores as lexical association sums, **not calibrated predictions**. If the directory or the word file is absent, those five markers are `not_run` and the other markers still run. |
| VADER (Hutto & Gilbert 2014) | MIT | Message tone. The paper's r = .881 is agreement with human ratings of tweets, not agreement with a questionnaire. |
| Empath (Fast, Chen & Bernstein 2016) | MIT | A vendored category subset (including art, reading, and philosophy for the intellect marker, plus emotion, anger, and swearing). The paper's r = .906 is agreement with similar LIWC categories, not a person-level score. |
| Our own word lists (pronouns already in the app, absolutist list already in the app, plus tentative, worry, negative emotion, anger, swear, achievement, second person, substance, gambling, craving) | Project license (MIT) | Used where a published dictionary cannot be redistributed. Tokenization matches the main report. |
| NRC Emotion Lexicon | Research use is noncommercial, and **redistribution is not allowed** | **Not shipped.** Not downloaded by the app. |
| LIWC-22 | Proprietary. The dictionaries cannot be shared. | **Not shipped.** Not downloaded by the app. |

Attribution for the WWBP lists also includes Schwartz et al. 2013 (10.1371/journal.pone.0073791) and Park et al. 2015. Two earlier language-and-personality papers were checked and are not used as weights, because the design does not quote a figure we would need: Pennebaker & King 1999 (10.1037/0022-3514.77.6.1296) and Mairesse et al. 2007 (10.1613/jair.2349).

## Privacy

- The section adds two consents on top of the existing DeepSeek opt-in. The exact sentences come from `GET /config` (`experimental_opt_in_text`, `score_other_opt_in_text`). The client echoes them back. A mismatch is rejected. The demo, whose people are synthetic, does not require the echo.
- Scoring the other person requires the experimental-scores consent first. The second consent says they have not agreed, that the result stays on this computer, and that it should not be shared or used to judge them. Real chats default this to off. The demo defaults it to on.
- With AI scoring on, the extra calls resend excerpts from episodes **already** selected for the main rubric. The overall rating does not send a new slice of the library. Word-count-only mode makes no network call for this section.
- Scores and experimental quotes are stored only inside the local report. `DELETE /analyses/{id}` removes the report, including this section. There is no separate log of the text.
- Experimental quotes live only under `experimental_scores.quotes` (ids `xq_001`, …). They are not added to the report's main `quotes` list and they are not cited by observations.
- The API still binds to 127.0.0.1. There is no share or export control for this card.

## Limitations

- Not validated on iMessage, or on any messaging app. The published r values are for other genres and, for the Big Five models, mostly for large groups.
- Even the stronger language models are modest (about r = .3 to .4). Two people with the same questionnaire score can get very different indexes. The band is there because the point value moves around.
- Narcissism-related, attachment-related, and addictive-tendency language are very weak. Depression-related, anxiety-related, and anger/hostility language are small, and a single chat is a weaker setting than the papers. Confidence on those six stays low no matter how long the thread is.
- Attachment evidence is from romantic narratives. The indexes still appear on other kinds of chats, with the very-weak label.
- One thread is the relationship and the week, not a trait that travels with the person.
- The 0–100 scale is ours. 50 is an anchor midpoint. Engineering anchors are not population data. Nothing on the scale is a dividing line. The report does not contain percentiles, T-scores, norms, or high/low labels.
- The overall AI rating is biased (age, gender, and the agreeableness / conscientiousness / extraversion pattern in Marengo et al. 2025) and is poor at knowing when the text is too thin (Piastra & Catellani 2025). Its weight is capped. It can still be wrong.
- WWBP sums are association totals from Facebook-style open vocabulary, not calibrated scores, and the files are non-commercial.
- VADER's published agreement is with tweet raters. Empath's published agreement is with other dictionaries. Neither number is a validity coefficient for this index.
- Saying "I" is not used as a narcissism marker (Carey et al. 2015, r = .01).
- Absolutist words and forum classifiers are group findings. They do not say what one person's week means.
- The section does not flag crisis, suicidal ideation, self-harm, or relapse, and the support footer is always on the card. It is not turned on by a score.
- Not scored, on purpose: impulsivity / UPPS-P (called out as critical in the audit, and no text validation), bipolar, borderline, and psychopathy (no defensible one-chat marker, and the labels stigmatize), and message-timing entropy (not validated).
- Below 20 episodes or 1,500 words for that person, the index is withheld. Thin weeks are withheld on the trend.
- The other person did not ask to be scored. Their numbers stay on this computer.

## What was checked, and what was not

Every number in this file is taken from [`experimental/SCORES_DESIGN_v2.md`](experimental/SCORES_DESIGN_v2.md) section 3 or section 15 (papers whose existence and quoted figures were checked). Papers the design lists as not independently verified are not cited here and are not used as weights. In particular this file does not use a narcissism pronoun correlation from a small older study, a claimed neuroticism bias beyond Marengo et al. 2025, Likes-based substance-use figures, or the forum absolutist percentages that were only second-hand.
