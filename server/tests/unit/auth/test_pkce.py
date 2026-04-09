"""Unit tests for PKCE verification logic."""

import base64
import hashlib

from proliferate.auth.pkce import verify_pkce


def _make_challenge(verifier: str) -> str:
    """Compute S256 challenge from a verifier."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class TestVerifyPKCE:
    def test_valid_s256(self) -> None:
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        challenge = _make_challenge(verifier)
        assert verify_pkce(verifier, challenge, "S256") is True

    def test_wrong_verifier(self) -> None:
        verifier = "correct-verifier"
        challenge = _make_challenge(verifier)
        assert verify_pkce("wrong-verifier", challenge, "S256") is False

    def test_unsupported_method(self) -> None:
        verifier = "some-verifier"
        challenge = _make_challenge(verifier)
        assert verify_pkce(verifier, challenge, "plain") is False

    def test_empty_verifier(self) -> None:
        challenge = _make_challenge("")
        assert verify_pkce("", challenge, "S256") is True

    def test_long_verifier(self) -> None:
        verifier = "a" * 128
        challenge = _make_challenge(verifier)
        assert verify_pkce(verifier, challenge, "S256") is True

    def test_special_base64_chars(self) -> None:
        """Verify that base64url encoding handles +/= correctly."""
        # Pick a verifier whose SHA-256 produces base64 padding
        verifier = "test-verifier-with-padding-chars"
        challenge = _make_challenge(verifier)
        assert verify_pkce(verifier, challenge, "S256") is True
        # Challenge should NOT contain + or / or =
        assert "+" not in challenge
        assert "/" not in challenge
        assert "=" not in challenge
