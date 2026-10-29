"""Built-in LLM defaults (no secrets).

The DeepSeek API key is NOT in git. Provide it with the DEEPSEEK_API_KEY environment variable or a `.env` file
(gitignored) at the repo root or ~/.psychosight/.env: `cp .env.example .env`, then paste the key.
"""

# "DeepSeek 4.1 flash 1017": GET https://api.deepseek.com/models lists id "deepseek-flash" (name
# "DeepSeek-V4.1-Flash", effort levels low/high/max); DeepSeek's docs say it is served by DeepSeek-V4.1-Flash-1017.
DEFAULT_DEEPSEEK_MODEL = "deepseek-flash"
DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
# Highest documented thinking effort for deepseek-flash.
DEFAULT_REASONING_EFFORT = "max"
