"""Pure first-run setup token rules: minting, hashing, comparison."""

from __future__ import annotations

import hashlib
import hmac
import secrets

_TOKEN_HEX_BYTES = 16
_TOKEN_GROUP_SIZE = 4


def mint_setup_token() -> str:
    """Mint a 128-bit token formatted in readable 4-character groups."""
    raw = secrets.token_hex(_TOKEN_HEX_BYTES)
    return "-".join(raw[i : i + _TOKEN_GROUP_SIZE] for i in range(0, len(raw), _TOKEN_GROUP_SIZE))


def hash_setup_token(token: str) -> str:
    """SHA-256 of the trimmed token.

    The token is high-entropy, so a plain (unsalted, fast) hash is an adequate
    verifier; only the hash is persisted.
    """
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


def setup_token_matches(candidate: str, token_hash: str) -> bool:
    return hmac.compare_digest(hash_setup_token(candidate), token_hash)
