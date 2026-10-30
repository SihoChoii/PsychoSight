# WWBP Big Five lexicon

This folder is removable. Deleting it leaves PsychoSight working. The `wwbp.*`
markers are then reported not run, with reason `wwbp lexicon not installed`.

## What this file is

`bigfive_lexicon.json` is the Big Five weighted lexicon shipped by the
open-source `bigfive` package (P. Hughes,
https://github.com/phughesmcr/bigfive, archived; the project now points at
wwbnlp). The package says:

> Using the Big Five lexicon data from WWBP under the Creative Commons
> Attribution-NonCommercial-ShareAlike 3.0 Unported.

Each trait has 200 terms from that file: 100 positively associated and 100
negatively associated, including phrases. The weights are the package weights,
unchanged. This is not a vocabulary written for PsychoSight.

## Scores are not predictions

The `bigfive` / wwbnlp package notes that these scores are lexical association
sums, not calibrated trait predictions. PsychoSight uses them the same way: a
weighted sum of matched terms, scaled per 100 words
(`100 * sum(weight * count) / word count`). They are not a personality test
and not a measure of who anyone is.

## License and use

- License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported
  (CC BY-NC-SA 3.0). See `LICENSE-CC-BY-NC-SA-3.0.txt`.
- Non-commercial / hackathon-only. Remove this entire folder before any
  commercial use.
- Attribution: World Well-Being Project (University of Pennsylvania and
  Stony Brook University). Lexicon distributed via the `bigfive` package by
  P. Hughes. Research background: Schwartz et al. 2013, PLOS ONE
  (doi:10.1371/journal.pone.0073791) and Park et al. 2015.
- ShareAlike: if you share an adaptation of this lexicon, keep the same license
  and this attribution.

## Matching

A term is matched only when `features.tokenize` reproduces the term exactly
(lowercase, tokens joined by a single space). Symbol and punctuation forms
(emoticons, a trailing "!") therefore do not match. When the package lists
both `great day` and `great day !`, the exact token form is the one that
matches. Phrases do not cross message boundaries.
