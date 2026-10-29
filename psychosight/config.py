"""Constants and environment readers. Secrets come from the environment or a gitignored `.env` file (repo root or
~/.psychosight/.env) and are never logged or written anywhere."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import __version__, defaults

BACKEND_VERSION = __version__
SCHEMA_VERSION = "1.0.0"
PROMPT_VERSION = "rubric-v1"
SYNTHESIS_PROMPT_VERSION = "synthesis-v2"
EXTRACTOR_VERSION = "features-v1"

TURN_GAP_S = 30
EPISODE_GAP_S = 1200
MIN_WORDS = 300
POOL_EPISODE_WORDS = 100
MIN_EPISODES = 3
MIN_REPLIES = 3
MIN_TURNS = 10
MAX_EPISODES_SCORED = 40
# Characters of one message included in an LLM prompt. The rest is omitted so one huge
# message cannot dominate memory or the request. Quotes are still checked against the original.
MAX_MESSAGE_PROMPT_CHARS = 8000
TOP_SIGNAL_SHARE = 0.6
SELECTION_SEED = 1017
ITEM_MIN_EPISODES = 3
ITEM_MIN_AGREEMENT = 0.7
HIGH_CONFIDENCE_AGREEMENT = 0.8
MAX_LLM_CALLS = 200
LLM_CONCURRENCY = 8  # parallel episodes; override with PSYCHOSIGHT_LLM_CONCURRENCY

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEMO_CONVERSATION_ID = "demo"
DEMO_LABEL = "Demo conversation (synthetic)"

PLACEHOLDER_KEY = "your-key-here"
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
    "quotes from the analysis are saved in the local report until you delete it. The demo conversation is synthetic: "
    "its excerpts are fictional messages written for the demo. If you do not opt in, you "
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


PLACEHOLDER_KEY = "your-key-here"
REPO_ROOT = Path(__file__).resolve().parents[1]


def dotenv_paths() -> list:
    """Files read for settings not in the environment. PSYCHOSIGHT_DOTENV (os-separated list) overrides."""
    override = os.environ.get("PSYCHOSIGHT_DOTENV", "").strip()
    if override:
        return [Path(p).expanduser() for p in override.split(os.pathsep) if p]
    return [REPO_ROOT / ".env", Path.home() / ".psychosight" / ".env"]


def parse_dotenv(text: str) -> dict:
    """Minimal KEY=VALUE parser (no dependency): '#' comments, optional 'export ', optional quotes."""
    values = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        if key:
            values[key] = value
    return values


def _dotenv() -> dict:
    """Merged .env values; earlier files win. Read on each call so edits apply without a restart."""
    merged: dict = {}
    for path in dotenv_paths():
        try:
            values = parse_dotenv(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        for k, v in values.items():
            merged.setdefault(k, v)
    return merged


def _env_with_source(name: str) -> tuple:
    value = os.environ.get(name, "").strip()
    if value:
        return value, "env"
    value = (_dotenv().get(name) or "").strip()
    return (value, "dotenv") if value else (None, None)


def _env(name: str) -> Optional[str]:
    """Environment variable, falling back to the .env files."""
    return _env_with_source(name)[0]


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
    key_source: Optional[str] = None  # "env", "dotenv" or None

    def __repr__(self) -> str:  # never show the key
        return (
            f"LLMSettings(model={self.model!r}, base_url={self.base_url!r}, "
            f"reasoning_effort={self.reasoning_effort!r}, api_key={mask_key(self.api_key)!r}, key_source={self.key_source!r})"
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.model)


def mask_key(key: Optional[str]) -> str:
    """Never show a key in full: 'sk-…1a2b' (or 'unset')."""
    if not key:
        return "unset"
    return f"{key[:3]}…{key[-4:]}" if len(key) > 12 else "…"


def llm_settings() -> LLMSettings:
    max_tokens = _env("DEEPSEEK_MAX_TOKENS")
    api_key, key_source = _env_with_source("DEEPSEEK_API_KEY")
    if api_key == PLACEHOLDER_KEY:  # .env copied from .env.example but not filled in
        api_key, key_source = None, None
    return LLMSettings(
        api_key=api_key,
        key_source=key_source,
        # Default is "DeepSeek 4.1 flash 1017" (id deepseek-flash); DEEPSEEK_MODEL overrides.
        model=_env("DEEPSEEK_MODEL") or defaults.DEFAULT_DEEPSEEK_MODEL,
        base_url=(_env("DEEPSEEK_BASE_URL") or defaults.DEFAULT_DEEPSEEK_BASE_URL).rstrip("/"),
        # Highest documented effort by default; set DEEPSEEK_REASONING_EFFORT=none to disable thinking.
        reasoning_effort=_env("DEEPSEEK_REASONING_EFFORT") or defaults.DEFAULT_REASONING_EFFORT,
        thinking=_env("DEEPSEEK_THINKING") or "enabled",
        json_mode=(_env("DEEPSEEK_JSON_MODE") or "1") not in ("0", "false", "no"),
        send_temperature=(_env("DEEPSEEK_SEND_TEMPERATURE") or "1") not in ("0", "false", "no"),
        timeout_s=float(_env("DEEPSEEK_TIMEOUT_S") or 300),  # max-effort synthesis took ~110 s live
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


MOCK_NOTE_NO_KEY = ("not real model: offline mock scores for the synthetic demo, because no DeepSeek key was found "
                    "(copy .env.example to .env and add the key to run the real model)")
MOCK_NOTE_FORCED = "not real model: offline mock scores for the synthetic demo (PSYCHOSIGHT_DEMO_PROVIDER=mock)"


def demo_provider_name() -> str:
    """Provider for the synthetic demo: the real DeepSeek model whenever a key is configured, else the offline mock.
    PSYCHOSIGHT_DEMO_PROVIDER=mock|deepseek overrides (tests and CI pin mock)."""
    forced = (_env("PSYCHOSIGHT_DEMO_PROVIDER") or "").lower()
    if forced in ("mock", "deepseek"):
        return forced
    return "deepseek" if llm_settings().configured else "mock"


def demo_provider_note() -> Optional[str]:
    """User-visible label when the demo does not use the real model (None when it does)."""
    if demo_provider_name() != "mock":
        return None
    return MOCK_NOTE_FORCED if (_env("PSYCHOSIGHT_DEMO_PROVIDER") or "").lower() == "mock" else MOCK_NOTE_NO_KEY


def llm_concurrency() -> int:
    return max(1, int(_env("PSYCHOSIGHT_LLM_CONCURRENCY") or LLM_CONCURRENCY))


def port() -> int:
    return int(_env("PSYCHOSIGHT_PORT") or DEFAULT_PORT)


def static_dir() -> Optional[Path]:
    override = _env("PSYCHOSIGHT_STATIC_DIR")
    if override:
        return Path(override).expanduser()
    web = REPO_ROOT / "web"
    if (web / "dist").is_dir():
        return web / "dist"
    # web/ is only served as-is when it is plain static files; a Vite project (package.json) must be built first,
    # otherwise its raw index.html would load /src/main.tsx and show a blank page.
    if web.is_dir() and (web / "index.html").is_file() and not (web / "package.json").is_file():
        return web
    return None


def unbuilt_ui_hint() -> Optional[str]:
    web = REPO_ROOT / "web"
    if not _env("PSYCHOSIGHT_STATIC_DIR") and (web / "package.json").is_file() and not (web / "dist").is_dir():
        return "web UI is not built: run `cd web && npm install && npm run build`, then restart serve"
    return None
