from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet


def _fernet(*, secret: str) -> Fernet:
    secret_bytes = secret.encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret_bytes).digest())
    return Fernet(key)


def encrypt_json(payload: dict[str, Any], *, secret: str) -> str:
    plaintext = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return _fernet(secret=secret).encrypt(plaintext).decode("utf-8")


def decrypt_json(ciphertext: str, *, secret: str) -> dict[str, Any]:
    plaintext = _fernet(secret=secret).decrypt(ciphertext.encode("utf-8"))
    value = json.loads(plaintext.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("encrypted payload did not contain an object")
    return value


def encrypt_text(value: str, *, secret: str) -> str:
    return _fernet(secret=secret).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_text(ciphertext: str, *, secret: str) -> str:
    return _fernet(secret=secret).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
