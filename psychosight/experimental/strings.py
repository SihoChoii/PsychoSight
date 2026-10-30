"""Fixed user-facing strings for the experimental scores section (contract, frozen).

Every string here is rendered verbatim by the frontend (via GET /config or the report) and is part of
the experimental allow-list in ``psychosight.safety.EXP_ALLOW_LIST``. Change only through the integrator.
This module must not import other psychosight modules (it is imported by ``safety`` and ``contract``).
"""

from __future__ import annotations

from typing import Dict, Tuple

TITLE = "Experimental scores"

BANNER = (
    "Experimental, not validated. These scores are not a diagnosis, not a personality test and not a measure "
    "of who anyone is. They come from word counts and AI ratings of this one conversation and can easily be wrong."
)

SCALE_NOTE = (
    "0–100 experimental index. 50 is the midpoint of fixed reference points, not an average person. "
    "The shaded band shows how uncertain the number is."
)

# Shown next to the weekly trend sparkline (GET /config `experimental_trend_note`). Neutral on purpose:
# weekly values can sit above or below the overall index.
TREND_NOTE = (
    "Weekly trend values are on their own scale and are not directly comparable to the overall index."
)

EXPERIMENTAL_CONSENT = (
    "Show experimental personality and well-being language scores. These are 0–100 numbers built from word "
    "counts and AI ratings. They are not validated and are not a diagnosis. With AI scoring on, the same "
    "excerpts already selected are sent to DeepSeek again with extra questions."
)

SCORE_OTHER_CONSENT = (
    "Also score the other person. They have not agreed to be scored. Their scores are an experimental reading "
    "of their messages in this conversation only, stay on this computer, and should not be shared or used to "
    "judge them."
)

FOOTER_SUPPORT = (
    "If anything in this conversation is weighing on you, consider talking with someone you trust or a "
    "licensed professional."
)

# Plain-English validity statement (design v2 section 1). Shown behind "How this works".
HOW_IT_WORKS = (
    "These numbers come from word counts and AI ratings of text messages. The research behind them looked at "
    "essays, Facebook posts, blogs and forums, mostly from large groups of people. Nobody has tested these "
    "formulas on iMessage conversations.\n\n"
    "The best published language-based personality models are modest. Agreement with self-report "
    "questionnaires is around r = .3 to .4 (Park et al. 2015; Azucar et al. 2018), and AI models asked "
    "directly come in around r = .29 (Peters & Matz 2024). Two people with the same true trait can easily "
    "get very different scores.\n\n"
    "Narcissism, attachment and addiction language have much weaker or exploratory evidence. Some popular "
    "ideas have failed outright: saying \"I\" a lot is not linked to narcissism (Carey et al. 2015, r = .01).\n\n"
    "One conversation reflects the relationship and the moment as much as the person. Your score with one "
    "person and your score with another can differ.\n\n"
    "The 0–100 scale is our own construction. 50 is the midpoint of fixed reference anchors. It is not an "
    "average person, and nothing on the scale is a dividing line.\n\n"
    "People tend to find vague personality feedback accurate (the Barnum effect, Forer 1949). Treat these "
    "scores as conversation starters, not facts."
)

FAMILY_LABELS: Dict[str, str] = {
    "big_five": "Big Five",
    "wellbeing_language": "Well-being language",
    "interpersonal": "Interpersonal language",
}

# Dimension key -> display label (registry order).
DIMENSION_LABELS: Dict[str, str] = {
    "openness": "Openness (experimental language index)",
    "conscientiousness": "Conscientiousness (experimental language index)",
    "extraversion": "Extraversion (experimental language index)",
    "agreeableness": "Agreeableness (experimental language index)",
    "neuroticism": "Neuroticism (experimental language index)",
    "depression_language": "Depression-related language (experimental language index)",
    "anxiety_language": "Anxiety-related language (experimental language index)",
    "addictive_language": "Addictive-tendency language (experimental language index)",
    "anger_hostility_language": "Anger/hostility language (experimental language index)",
    "narcissism_language": "Narcissism-related language (experimental language index)",
    "attachment_anxious_language": "Anxious-attachment-related language (experimental language index)",
    "attachment_avoidant_language": "Avoidant-attachment-related language (experimental language index)",
}

_EVIDENCE_TOPIC: Dict[str, Tuple[str, str]] = {
    "openness": ("openness", "moderate"),
    "conscientiousness": ("conscientiousness", "moderate"),
    "extraversion": ("extraversion", "moderate"),
    "agreeableness": ("agreeableness", "moderate"),
    "neuroticism": ("neuroticism", "moderate"),
    "depression_language": ("depression", "small"),
    "anxiety_language": ("anxiety", "small"),
    "addictive_language": ("addictive tendencies", "very weak"),
    "anger_hostility_language": ("anger and hostility", "small"),
    "narcissism_language": ("narcissism", "very weak"),
    "attachment_anxious_language": ("anxious attachment", "very weak"),
    "attachment_avoidant_language": ("avoidant attachment", "very weak"),
}

# "Language markers associated in research with ...; evidence: <strength>"
EVIDENCE_NOTES: Dict[str, str] = {
    key: f"Language markers associated in research with {topic}; evidence: {strength}"
    for key, (topic, strength) in _EVIDENCE_TOPIC.items()
}

# Reasons and state texts (the frontend shows these; the backend uses them verbatim).
INSUFFICIENT_DATA_TEXT = "Not enough data (needs 20 episodes and 1,500 words)"
REASON_NOT_REQUESTED = "not requested"
REASON_DISABLED = "disabled by configuration"
REASON_FAILED = "Experimental scores could not be computed for this run."
REASON_LLM_NOT_RUN = "AI scoring was not run for this report"
REASON_WWBP_MISSING = "wwbp lexicon not installed"
REASON_TOO_FEW_MARKERS = "fewer than 2 markers with data, or no word-count marker with data"
REASON_TOO_FEW_EPISODES = "fewer than 20 episodes for this person"
REASON_TOO_FEW_WORDS = "fewer than 1,500 words for this person"
REASON_TREND_THIN_WEEK = "fewer than 300 words or 3 episodes this week"
LINT_FALLBACK = "Not shown (wording check)"
CONSENT_ERROR_MESSAGE = "Scoring the other person requires the experimental scores consent."
CONSENT_MISMATCH_MESSAGE = "The experimental consent text does not match the current text from GET /config."

# Every exact constant that may contain words the global lint bans. Applies only to strings under
# `experimental_scores` and to the holistic prompt (Track B appends its prompt in safety.EXP_ALLOW_LIST).
ALLOW_LIST_CONSTANTS: Tuple[str, ...] = (
    (BANNER, SCALE_NOTE, TREND_NOTE, EXPERIMENTAL_CONSENT, SCORE_OTHER_CONSENT, FOOTER_SUPPORT, HOW_IT_WORKS, TITLE)
    + tuple(DIMENSION_LABELS.values())
    + tuple(EVIDENCE_NOTES.values())
)
