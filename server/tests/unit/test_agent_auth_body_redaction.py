"""Regression test for the main.py whole-body redaction gate (S1).

``_redacts_entire_body`` matches on ``"/agent-auth/keys" in request.url.path``
-- a substring covering the whole key-vault subtree, not just an exact suffix.
S1 moved the key-vault create route from ``/v1/cloud/agent-gateway/keys`` to
``/v1/cloud/agent-auth/keys``; missing the matching update in ``main.py``
would silently stop redacting the echoed raw-key input on a 422, leaking key
material back to the caller. The provider-config route
(``POST .../agent-auth/keys/provider-config``) carries a raw credential
nested under ``value`` (e.g. ``value.apiKey`` for azure_openai) and must be
covered by the same predicate -- the field-name fallback in
``_SENSITIVE_INPUT_FRAGMENTS`` does not catch ``apiKey``, so the path-based
check is the only thing standing between a malformed provider-config body and
a leaked key. There was no direct test pinning this predicate before this PR
-- only an indirect assertion buried in an integration test -- so a future
route rename could regress it again with no CI signal.
"""

from __future__ import annotations

import pytest
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.requests import Request

from proliferate.main import _redacts_entire_body, _validation_error_handler
from proliferate.server.agent_auth.models import (
    AgentApiKeyCreateRequest,
    AgentProviderConfigCreateRequest,
)

RAW_KEY_MUST_NOT_LEAK = "sk-ant-api03-regression-guard-should-never-appear-in-response"


def _post_request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("test", 80),
            "client": ("test", 1),
        }
    )


def test_redacts_entire_body_matches_the_current_agent_auth_keys_route() -> None:
    assert _redacts_entire_body(_post_request("/v1/cloud/agent-auth/keys")) is True


def test_redacts_entire_body_no_longer_matches_the_old_agent_gateway_route() -> None:
    # Pins the moved route explicitly: if a future change reverts the prefix
    # (or copies the old suffix check back in), this must fail loudly instead
    # of silently disabling redaction on the live route.
    assert _redacts_entire_body(_post_request("/v1/cloud/agent-gateway/keys")) is False


def test_redacts_entire_body_matches_the_provider_config_route() -> None:
    # provider-config carries a raw credential nested under value (e.g.
    # value.apiKey for azure_openai); it must be redacted wholesale on a 422
    # just like the plain key-create route, since the field-name fallback
    # does not recognize "apiKey" as sensitive.
    provider_config = _post_request("/v1/cloud/agent-auth/keys/provider-config")
    assert _redacts_entire_body(provider_config) is True


def test_redacts_entire_body_does_not_match_unrelated_post_routes() -> None:
    selections = _post_request("/v1/cloud/agent-auth/selections/claude")
    assert _redacts_entire_body(selections) is False


@pytest.mark.asyncio
async def test_validation_error_handler_redacts_raw_key_for_the_new_route() -> None:
    """End-to-end through the real handler: a malformed body that fails
    pydantic validation must never echo the raw key value in the 422
    response, on the NEW route path.
    """
    body = {"title": ["not-a-string-title"], "value": RAW_KEY_MUST_NOT_LEAK}
    with pytest.raises(ValidationError) as captured:
        AgentApiKeyCreateRequest.model_validate(body)

    request = _post_request("/v1/cloud/agent-auth/keys")
    response = await _validation_error_handler(
        request,
        RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in captured.value.errors()]
        ),
    )

    encoded = response.body.decode("utf-8")
    assert response.status_code == 422
    assert RAW_KEY_MUST_NOT_LEAK not in encoded
    assert "[redacted]" in encoded


@pytest.mark.asyncio
async def test_validation_error_handler_redacts_raw_api_key_for_provider_config() -> None:
    """End-to-end through the real handler: a malformed provider-config body
    that fails pydantic validation must never echo the raw ``value.apiKey``
    credential in the 422 response.

    The body omits ``kind`` (a required field) rather than mis-typing
    ``title``: pydantic's "missing" error echoes the WHOLE input document
    (there is no narrower sub-value to point at), so ``value.apiKey`` is
    genuinely present in the raw ``input`` this handler redacts. A type
    error on a sibling field would only echo that field's own value, never
    exercising the whole-body redaction path this test exists to pin.
    """
    body = {
        "title": "t",
        "value": {"apiKey": RAW_KEY_MUST_NOT_LEAK, "endpoint": "https://example.invalid"},
    }
    with pytest.raises(ValidationError) as captured:
        AgentProviderConfigCreateRequest.model_validate(body)

    request = _post_request("/v1/cloud/agent-auth/keys/provider-config")
    response = await _validation_error_handler(
        request,
        RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in captured.value.errors()]
        ),
    )

    encoded = response.body.decode("utf-8")
    assert response.status_code == 422
    assert RAW_KEY_MUST_NOT_LEAK not in encoded
    assert "[redacted]" in encoded
