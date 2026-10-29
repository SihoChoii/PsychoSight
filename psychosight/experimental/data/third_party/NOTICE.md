# Third-party lexicons

These files are data. They are word lists used as counts. They are not labels,
not a diagnosis, and not a flag.

## VADER

- File: `vader_lexicon.txt`
- Source: https://github.com/cjhutto/vaderSentiment (`vaderSentiment/vader_lexicon.txt`)
- Authors: C.J. Hutto and Eric Gilbert
- License: MIT. See `LICENSE-VADER-MIT`. Copyright (c) 2016 C.J. Hutto.
- Citation: Hutto, C.J. and Gilbert, E.E. (2014). VADER: A Parsimonious
  Rule-based Model for Sentiment Analysis of Social Media Text. Eighth
  International Conference on Weblogs and Social Media (ICWSM-14).

The scorer in `lexicons.py` looks up message tokens in this lexicon. A negation
token in the previous 3 tokens multiplies that hit by -0.74 (VADER's negation
scalar). The message value is `sum / sqrt(sum^2 + 15)`, then averaged across
the speaker's messages. Intensifiers, capitalization, and punctuation emphasis
from the full VADER scorer are not applied. Entries that `features.tokenize`
turns into no tokens (emoticons) do not match.

## Empath

- File: `empath_subset.tsv` (tab-separated category name, then the category's words)
- Source: https://github.com/Ejhfast/empath-client (`empath/data/categories.tsv`)
- Authors: Ethan Fast, Binbin Chen, and Michael Bernstein
- License: MIT. See `LICENSE-EMPATH-MIT`. Copyright (c) 2016 Ethan Fast.
- Citation: Fast, E., Chen, B., and Bernstein, M.S. (2016). Empath: Understanding
  Topic Signals in Large-Scale Text. CHI.

Categories copied unchanged, in this order: `negative_emotion`, `sadness`,
`nervousness`, `anger`, `rage`, `swearing_terms`, `alcohol`, `achievement`,
`work`, `sports`, `positive_emotion`, `affection`, `friends`, `family`, `art`,
`reading`, `philosophy`.

The TSV is the upstream lists. When a category is counted toward a marker, a
few high-frequency tokens that are not the topic of that category are skipped
in code (`lexicons.EMPATH_COUNT_SKIP`). Examples: `thinking` (listed under
`negative_emotion`), `always` (listed under `friends`), `bad` (listed under
`swearing_terms`). The file itself is not edited. `alcohol` and `sports` are
shipped with the subset; the substance marker uses our own narrower list,
because the Empath alcohol list includes container words such as cup and fridge.

Our own lists live in `../wordlists/` under the MIT license (`LICENSE-MIT.txt`).
