from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from proliferate.integrations.integration_oauth.models import AuthorizationServerMetadata


def random_urlsafe(size: int = 32) -> str:
    return secrets.token_urlsafe(size)


def code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def normalize_resource_url(value: str) -> str:
    parsed = urlparse(value)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    if netloc.endswith(":443") and scheme == "https":
        netloc = netloc[:-4]
    if netloc.endswith(":80") and scheme == "http":
        netloc = netloc[:-3]
    query = urlencode(sorted(parse_qsl(parsed.query, keep_blank_values=True)))
    return urlunparse((scheme, netloc, parsed.path or "/", "", query, ""))


def build_authorization_url(
    *,
    metadata: AuthorizationServerMetadata,
    client_id: str,
    redirect_uri: str,
    state: str,
    verifier: str,
    resource: str,
    scope: str | None,
) -> str:
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge(verifier),
        "code_challenge_method": "S256",
        "state": state,
        "resource": resource,
    }
    if scope:
        params["scope"] = scope
    separator = "&" if "?" in metadata.authorization_endpoint else "?"
    return f"{metadata.authorization_endpoint}{separator}{urlencode(params)}"
