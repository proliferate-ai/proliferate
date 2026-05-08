from __future__ import annotations

import base64


def decode_base64_json(data: str) -> str:
    return base64.b64decode(data.encode("utf-8")).decode("utf-8")


def has_portable_claude_file(data: dict[str, object], relative_path: str) -> bool:
    if relative_path == ".claude/.credentials.json":
        oauth = data.get("claudeAiOauth")
        if not isinstance(oauth, dict):
            return False
        access_token = oauth.get("accessToken")
        return isinstance(access_token, str) and bool(access_token)

    if relative_path == ".claude.json":
        for key in ("primaryApiKey", "apiKey", "anthropicApiKey", "customApiKey"):
            value = data.get(key)
            if isinstance(value, str) and value.startswith("sk-ant-"):
                return True
        return False

    return False


def has_portable_codex_file(data: dict[str, object]) -> bool:
    api_key = data.get("OPENAI_API_KEY")
    if isinstance(api_key, str) and api_key:
        return True
    tokens = data.get("tokens")
    if not isinstance(tokens, dict):
        return False
    access_token = tokens.get("access_token")
    return isinstance(access_token, str) and bool(access_token)


def has_portable_gemini_file(data: dict[str, object], relative_path: str) -> bool:
    if relative_path == ".gemini/oauth_creds.json":
        for key in ("access_token", "refresh_token"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return True
        return False

    if relative_path == ".gemini/settings.json":
        security = data.get("security")
        if not isinstance(security, dict):
            return False
        auth = security.get("auth")
        if not isinstance(auth, dict):
            return False
        return auth.get("selectedType") == "oauth-personal"

    return False
