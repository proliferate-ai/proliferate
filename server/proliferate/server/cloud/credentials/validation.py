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
