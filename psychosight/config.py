"""Constants and environment readers. Secrets are read from the environment only, never written anywhere."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import __version__

BACKEND_VERSION = __version__
SCHEMA_VERSION = "1.0.0"
PROMPT_VERSION = "rubric-v1"
SYNTHESIS_PROMPT_VERSION = "synthesis-v1"
EXTRACTOR_VERSION = "features-v1"

TURN_GAP_S = 30
EPISODE_GAP_S = 1200
MIN_WORDS = 300
POOL_EPISODE_WORDS = 100
MIN_EPISODES = 3
MIN_REPLIES = 3
MIN_TURNS = 10
MAX_EPISODES_SCORED = 40
TOP_SIGNAL_SHARE = 0.6
SELECTION_SEED = 1017
ITEM_MIN_EPISODES = 3
ITEM_MIN_AGREEMENT = 0.7
HIGH_CONFIDENCE_AGREEMENT = 0.8
MAX_LLM_CALLS = 200
LLM_CONCURRENCY = 4

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEMO_CONVERSATION_ID = "demo"
DEMO_LABEL = "Demo conversation (synthetic)"

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "schemas" / "report.schema.json"

DISCLAIMER = "Experimental self-reflection, not a clinical or diagnostic tool"
LIMITATIONS_TITLE = "What this cannot tell you"
LIMITATIONS = [
    "This is not a diagnosis, an assessment or a test, and it cannot detect any condition.",
    "It describes patterns in one text conversation only, not who you or the other person are.",
    "Text messages miss tone of voice, context, and everything said in person or on calls.",
    "Word rates and reply times are descriptive counts with no normal range and no cutoffs.",
    "Reply times are approximate: notifications, sleep and busy days all change them.",
    "AI-scored items can be wrong; items whose two scoring runs disagreed were left out.",
    "Quotes are short excerpts and can read differently out of context.",
]

OPT_IN_TEXT = (
    "To score communication patterns, PsychoSight will send excerpts of this conversation to DeepSeek "
    "(an external AI service). The excerpts include messages from BOTH sides: your messages and the other "
    "person's messages, which are sent as context. Up to 40 short episodes are sent; nothing else from your "
    "Messages library leaves this computer. DeepSeek processes the excerpts under its own terms. Evidence "
    "quotes from the analysis are saved in the local report until you delete it. If you do not opt in, you "
    "still get a local-only report without the AI sections."
)

NOT_RUN_REASON = (
    "LLM analysis was not run because the user did not opt in to sending excerpts to DeepSeek."
)


def thresholds() -> dict:
    return {
        "turn_gap_s": TURN_GAP_S,
        "episode_gap_s": EPISODE_GAP_S,
        "min_words": MIN_WORDS,
        "pool_episode_words": POOL_EPISODE_WORDS,
        "min_episodes": MIN_EPISODES,
        "min_replies": MIN_REPLIES,
        "min_turns": MIN_TURNS,
        "max_episodes_scored": MAX_EPISODES_SCORED,
    }


def _env(name: str) -> Optional[str]:
    value = os.environ.get(name, "").strip()
    return value or None


@dataclass(frozen=True)
class LLMSettings:
    api_key: Optional[str]
    model: Optional[str]
    base_url: str
    reasoning_effort: Optional[str]
    thinking: Optional[str]
    json_mode: bool
    send_temperature: bool
    timeout_s: float
    max_tokens: Optional[int]

    def __repr__(self) -> str:  # never show the key
        return (
            f"LLMSettings(model={self.model!r}, base_url={self.base_url!r}, "
            f"reasoning_effort={self.reasoning_effort!r}, api_key={'set' if self.api_key else 'unset'})"
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.model)


def llm_settings() -> LLMSettings:
    max_tokens = _env("DEEPSEEK_MAX_TOKENS")
    return LLMSettings(
        api_key=_env("DEEPSEEK_API_KEY"),
        # No hardcoded model: Siho supplies the exact id ("4.1 flash 1017") via DEEPSEEK_MODEL.
        model=_env("DEEPSEEK_MODEL"),
        base_url=(_env("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/"),
        # Highest documented effort by default; set DEEPSEEK_REASONING_EFFORT=none to disable thinking.
        reasoning_effort=_env("DEEPSEEK_REASONING_EFFORT") or "max",
        thinking=_env("DEEPSEEK_THINKING") or "enabled",
        json_mode=(_env("DEEPSEEK_JSON_MODE") or "1") not in ("0", "false", "no"),
        send_temperature=(_env("DEEPSEEK_SEND_TEMPERATURE") or "1") not in ("0", "false", "no"),
        timeout_s=float(_env("DEEPSEEK_TIMEOUT_S") or 180),
        max_tokens=int(max_tokens) if max_tokens else None,
    )


def data_dir() -> Path:
    path = Path(_env("PSYCHOSIGHT_DATA_DIR") or (Path.home() / ".psychosight")).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return data_dir() / "psychosight.db"


def chat_db_path() -> Path:
    return Path(_env("PSYCHOSIGHT_CHAT_DB") or (Path.home() / "Library" / "Messages" / "chat.db")).expanduser()


def demo_provider_name() -> str:
    return (_env("PSYCHOSIGHT_DEMO_PROVIDER") or "mock").lower()


def port() -> int:
    return int(_env("PSYCHOSIGHT_PORT") or DEFAULT_PORT)


def static_dir() -> Optional[Path]:
    override = _env("PSYCHOSIGHT_STATIC_DIR")
    if override:
        return Path(override).expanduser()
    for candidate in (REPO_ROOT / "web" / "dist", REPO_ROOT / "web"):
        if candidate.is_dir():
            return candidate
    return None
