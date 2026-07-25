"""PKCE (Proof Key for Code Exchange) helpers for the desktop auth flow.

Implements RFC 7636 S256 challenge/verification.
"""

import base64
import hashlib


def build_code_challenge(code_verifier: str) -> str | None:
    """Compute an S256 code challenge from a code verifier.

    Returns ``None`` if *code_verifier* contains non-ASCII characters.
    """
    try:
        digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    except UnicodeEncodeError:
        return None
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def verify_pkce(code_verifier: str, code_challenge: str, method: str = "S256") -> bool:
    """Verify that *code_verifier* matches the stored *code_challenge*.

    Only the ``S256`` method is supported.
    """
    if method != "S256":
        return False
    computed = build_code_challenge(code_verifier)
    return computed == code_challenge
