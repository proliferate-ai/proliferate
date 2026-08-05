from __future__ import annotations

import json
from typing import Any

from proliferate.lib.infra.encryption.fernet import decrypt_text, encrypt_text


def encrypt_json(payload: dict[str, Any], *, secret: str) -> str:
    plaintext = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return encrypt_text(plaintext, secret=secret)


def decrypt_json(ciphertext: str, *, secret: str) -> dict[str, Any]:
    value = json.loads(decrypt_text(ciphertext, secret=secret))
    if not isinstance(value, dict):
        raise ValueError("encrypted payload did not contain an object")
    return value
