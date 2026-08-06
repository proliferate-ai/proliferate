from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet


def _fernet(*, secret: str) -> Fernet:
    secret_bytes = secret.encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret_bytes).digest())
    return Fernet(key)


def encrypt_text(value: str, *, secret: str) -> str:
    return _fernet(secret=secret).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_text(ciphertext: str, *, secret: str) -> str:
    return _fernet(secret=secret).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
