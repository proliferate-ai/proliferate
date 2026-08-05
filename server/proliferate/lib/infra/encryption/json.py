from __future__ import annotations

import json
from typing import Any

from proliferate.lib.infra.encryption.fernet import _fernet


def encrypt_json(payload: dict[str, Any], *, secret: str) -> str:
    plaintext = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return _fernet(secret=secret).encrypt(plaintext).decode("utf-8")


def decrypt_json(ciphertext: str, *, secret: str) -> dict[str, Any]:
    plaintext = _fernet(secret=secret).decrypt(ciphertext.encode("utf-8"))
    value = json.loads(plaintext.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("encrypted payload did not contain an object")
    return value
