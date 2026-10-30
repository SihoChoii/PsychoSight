"""Constants and environment readers. Secrets come from the environment, a gitignored `.env` file (repo root or
~/.psychosight/.env) or, lowest priority, a `psychosight.env` bundled into the packaged macOS app at build time.
They are never logged or written anywhere by the backend."""

from __future__ import annotations

import logging
import os
import re
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import __version__, defaults
from .resources import frozen_root

BACKEND_VERSION = __version__
SCHEMA_VERSION = "1.1.0"
PROMPT_VERSION = "rubric-v1"
SYNTHESIS_PROMPT_VERSION = "synthesis-v3"
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
LLM_CONCURRENCY = 12  # main rubric calls in flight; override with PSYCHOSIGHT_LLM_CONCURRENCY
EXP_LLM_CONCURRENCY = 24  # experimental calls in flight; override with PSYCHOSIGHT_EXP_LLM_CONCURRENCY

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEMO_CONVERSATION_ID = "demo"
DEMO_LABEL = "Demo conversation (synthetic)"

PLACEHOLDER_KEY = "your-key-here"
REPO_ROOT = Path(__file__).resolve().parents[1]


def resource_root() -> Path:
    """Checkout root, or the frozen bundle directory that holds ``schemas/`` and ``web/dist``.

    Not the process working directory.
    """
    frozen = frozen_root()
    if frozen is not None:
        return frozen
    return REPO_ROOT


SCHEMA_PATH = resource_root() / "schemas" / "report.schema.json"

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


PACKAGE_DIR = Path(__file__).resolve().parent
BUNDLED_ENV_NAME = "psychosight.env"


def dotenv_paths() -> list:
    """Files read for settings not in the environment. PSYCHOSIGHT_DOTENV (os-separated list) overrides.

    A frozen app reads only ``~/.psychosight/.env``. It does not read a ``.env`` packed inside the bundle.
    """
    override = os.environ.get("PSYCHOSIGHT_DOTENV", "").strip()
    if override:
        return [Path(p).expanduser() for p in override.split(os.pathsep) if p]
    home = Path.home() / ".psychosight" / ".env"
    if frozen_root() is not None:
        return [home]
    return [REPO_ROOT / ".env", home]


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


def _app_resources_for(start) -> Optional[Path]:
    """`<X>.app/Contents/Resources` for the first `*.app` ancestor (with a Contents dir) of `start`, else None."""
    try:
        path = Path(start).expanduser().resolve()
    except (OSError, RuntimeError, TypeError, ValueError):
        return None
    for parent in [path] + list(path.parents):
        if parent.suffix == ".app" and (parent / "Contents").is_dir():
            return parent / "Contents" / "Resources"
    return None


def bundled_env_paths() -> list:
    """Candidate bundled key files, in lookup order (the first readable one is used).

    1. PSYCHOSIGHT_BUNDLED_ENV: an explicit path. When set, it is the ONLY candidate (tests and packagers pin it).
    2. `<package dir>/_bundled/psychosight.env` (PyInstaller, py2app or a bundled venv carrying the package).
    3. `<App>.app/Contents/Resources/psychosight.env`, derived from sys.executable, sys.argv[0] or this file
       by walking up to a `*.app/Contents` ancestor.
    """
    explicit = os.environ.get("PSYCHOSIGHT_BUNDLED_ENV", "").strip()
    if explicit:
        return [Path(explicit).expanduser()]
    paths = [PACKAGE_DIR / "_bundled" / BUNDLED_ENV_NAME]
    for start in (getattr(sys, "executable", None), (sys.argv[0] if sys.argv and sys.argv[0] else None), __file__):
        if not start:
            continue
        resources = _app_resources_for(start)
        if resources is not None:
            candidate = resources / BUNDLED_ENV_NAME
            if candidate not in paths:
                paths.append(candidate)
    return paths


def _bundled() -> dict:
    """Values from the first readable bundled file. Read on each call (cheap; a few hundred bytes)."""
    for path in bundled_env_paths():
        try:
            return parse_dotenv(path.read_text(encoding="utf-8"))
        except OSError:
            continue
    return {}


def _env_with_source(name: str) -> tuple:
    """(value, source): source is "env", "dotenv" or "bundled" (lowest priority), or (None, None)."""
    value = os.environ.get(name, "").strip()
    if value:
        return value, "env"
    value = (_dotenv().get(name) or "").strip()
    if value:
        return value, "dotenv"
    value = (_bundled().get(name) or "").strip()
    return (value, "bundled") if value else (None, None)


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
    key_source: Optional[str] = None  # "env", "dotenv", "bundled" or None

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


_KNOWN_SECRETS: set = set()
_SECRETS_LOCK = threading.Lock()


def remember_secret(value: Optional[str]) -> None:
    """Record a loaded key so log lines and error messages can be scrubbed of it, whatever its source."""
    if value and len(value) >= 8 and value != PLACEHOLDER_KEY:
        with _SECRETS_LOCK:
            _KNOWN_SECRETS.add(value)


def known_secrets() -> list:
    env_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    with _SECRETS_LOCK:
        values = set(_KNOWN_SECRETS)
    if env_key and len(env_key) >= 8 and env_key != PLACEHOLDER_KEY:
        values.add(env_key)
    return sorted(values, key=len, reverse=True)


_KEY_SHAPE = re.compile(r"sk-[A-Za-z0-9_\-]{16,}")


def redact(text, replacement: Optional[str] = None):
    """Replace any loaded key (and any key-shaped `sk-...` token) with its masked form (`sk-…1a2b`),
    or with `replacement` when given."""
    if not isinstance(text, str) or not text:
        return text
    for secret in known_secrets():
        if secret in text:
            text = text.replace(secret, replacement if replacement is not None else mask_key(secret))
    return _KEY_SHAPE.sub(lambda m: replacement if replacement is not None else mask_key(m.group(0)), text)


def _home_short(path: Path) -> str:
    try:
        return "~/" + str(Path(path).expanduser().relative_to(Path.home()))
    except ValueError:
        return str(path)


def key_search_locations() -> list:
    """Human-readable list of the places a key is looked for, in priority order (paths only, never values)."""
    places = ["the DEEPSEEK_API_KEY environment variable"]
    places += [f".env file {_home_short(p)}" for p in dotenv_paths()]
    bundled = bundled_env_paths()
    places.append("the app's bundled psychosight.env (" + ", ".join(_home_short(p) for p in bundled) + ")")
    return places


def missing_key_message() -> str:
    return ("No DeepSeek API key found. Looked in, in order: " + "; ".join(key_search_locations()) + ". "
            "To fix: Copy .env.example to .env and put the DeepSeek key in it (or export DEEPSEEK_API_KEY), "
            "or rebuild the app with scripts/inject_bundled_key.py (see docs/PACKAGING_KEY.md); "
            "then restart the backend.")


KEY_SOURCE_DESCRIPTIONS = {
    "env": "the DEEPSEEK_API_KEY environment variable",
    "dotenv": "the key in your .env file",
    "bundled": "the key bundled in the app (psychosight.env; rebuild with scripts/inject_bundled_key.py)",
}


def describe_key_source(settings: "LLMSettings") -> str:
    """Where the key came from plus its masked form, e.g. 'the key in your .env file (sk-…1a2b)'."""
    where = KEY_SOURCE_DESCRIPTIONS.get(settings.key_source or "", "DEEPSEEK_API_KEY")
    return f"{where} ({mask_key(settings.api_key)})" if settings.api_key else where


def default_reasoning_level() -> str:
    """Reasoning level used when a request does not choose one.

    DEEPSEEK_REASONING_EFFORT (validated against reasoning.REASONING_IDS) overrides the built-in default;
    DEEPSEEK_THINKING=disabled means "none". An invalid value is logged and the built-in default is used."""
    from . import reasoning
    raw = _env("DEEPSEEK_REASONING_EFFORT")
    if (_env("DEEPSEEK_THINKING") or "").strip().lower() == "disabled":
        return "none"
    if raw:
        try:
            return reasoning.validate(raw)
        except reasoning.InvalidReasoningLevelValue:
            logging.getLogger("psychosight").warning(
                "DEEPSEEK_REASONING_EFFORT is not one of %s; using %s", ", ".join(reasoning.REASONING_IDS),
                reasoning.DEFAULT_REASONING)
    return reasoning.DEFAULT_REASONING


def llm_settings() -> LLMSettings:
    max_tokens = _env("DEEPSEEK_MAX_TOKENS")
    api_key, key_source = _env_with_source("DEEPSEEK_API_KEY")
    if api_key == PLACEHOLDER_KEY:  # .env copied from .env.example but not filled in
        api_key, key_source = None, None
    remember_secret(api_key)
    return LLMSettings(
        api_key=api_key,
        key_source=key_source,
        # Default is "DeepSeek 4.1 flash 1017" (id deepseek-flash); DEEPSEEK_MODEL overrides.
        model=_env("DEEPSEEK_MODEL") or defaults.DEFAULT_DEEPSEEK_MODEL,
        base_url=(_env("DEEPSEEK_BASE_URL") or defaults.DEFAULT_DEEPSEEK_BASE_URL).rstrip("/"),
        # Default reasoning level (low unless DEEPSEEK_REASONING_EFFORT says otherwise; none = thinking off).
        reasoning_effort=default_reasoning_level(),
        thinking="disabled" if default_reasoning_level() == "none" else "enabled",
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


def exp_llm_concurrency() -> int:
    """Experimental stage only. Separate from the rubric setting because its calls are longer and it can
    run while the main rubric is still in flight."""
    return max(1, int(_env("PSYCHOSIGHT_EXP_LLM_CONCURRENCY") or EXP_LLM_CONCURRENCY))


def exp_overlap() -> bool:
    """Start the experimental model calls before the main rubric (real provider only).
    PSYCHOSIGHT_EXP_OVERLAP=0 turns it off and runs the stage after synthesis, as before."""
    return (_env("PSYCHOSIGHT_EXP_OVERLAP") or "1") not in ("0", "false", "no")


def port() -> int:
    return int(_env("PSYCHOSIGHT_PORT") or DEFAULT_PORT)


def static_dir() -> Optional[Path]:
    override = _env("PSYCHOSIGHT_STATIC_DIR")
    if override:
        return Path(override).expanduser()
    web = resource_root() / "web"
    if (web / "dist").is_dir():
        return web / "dist"
    # web/ is only served as-is when it is plain static files; a Vite project (package.json) must be built first,
    # otherwise its raw index.html would load /src/main.tsx and show a blank page.
    if web.is_dir() and (web / "index.html").is_file() and not (web / "package.json").is_file():
        return web
    return None


def unbuilt_ui_hint() -> Optional[str]:
    if getattr(sys, "frozen", False):
        return None
    web = resource_root() / "web"
    if not _env("PSYCHOSIGHT_STATIC_DIR") and (web / "package.json").is_file() and not (web / "dist").is_dir():
        return "web UI is not built: run `cd web && npm install && npm run build`, then restart serve"
    return None
