"""Unit coverage for gen-2 invocation identity and argument redaction.

RFC 8785 canonicalization is the invocation replay identity and the
argument-portability gate (``service_v2`` canonicalizes the request and the
arguments before accepting them), and ``main.py``'s validation-error handler
redacts argument values on exactly the invocation PUT route.
"""

from __future__ import annotations

import json

import pytest
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.requests import Request

from proliferate.main import _validation_error_handler
from proliferate.server.workflows.domain.invocation import canonical_json
from proliferate.server.workflows.models_v2 import WorkflowInvocationCreateRequestV2

# Canonical-number rules governing invocation replay identity: JSON number
# spellings that mean the same value must canonicalize identically, and
# integers outside the I-JSON safe range are rejected by canonicalization
# (the v2 argument-portability gate).
CANONICAL_NUMBER_CASES = [
    {"source": "1", "canonical": "1"},
    {"source": "1.0", "canonical": "1"},
    {"source": "1e0", "canonical": "1"},
    {"source": "-0", "canonical": "0"},
    {"source": "0.0", "canonical": "0"},
    {"source": "1.5", "canonical": "1.5"},
    {"source": "9007199254740991", "canonical": "9007199254740991"},
    {"source": "-9007199254740991", "canonical": "-9007199254740991"},
]
NON_PORTABLE_INTEGER_SOURCES = ["9007199254740992", "-9007199254740992"]


def test_number_spellings_canonicalize_to_replay_identity() -> None:
    for case in CANONICAL_NUMBER_CASES:
        assert canonical_json(json.loads(case["source"])) == case["canonical"]


def test_integers_outside_safe_range_are_rejected_by_canonicalization() -> None:
    for source in NON_PORTABLE_INTEGER_SOURCES:
        with pytest.raises(ValueError):
            canonical_json(json.loads(source))


@pytest.mark.parametrize("value", ["2", 2.0, True, None])
def test_invocation_schema_version_requires_exact_integer(value: object) -> None:
    with pytest.raises(ValidationError):
        WorkflowInvocationCreateRequestV2.model_validate(
            {
                "schemaVersion": value,
                "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
                "arguments": {},
                "placement": {"repoConfigId": "root-1", "mode": "worktree"},
            }
        )


@pytest.mark.asyncio
async def test_workflow_invocation_422_redacts_argument_values_only_for_this_route() -> None:
    body = {
        "schemaVersion": 2,
        "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
        "arguments": {"ticket": ["ARGUMENT_VALUE_MUST_NOT_LEAK"]},
        "placement": {"repoConfigId": "root-1", "mode": "worktree"},
    }
    with pytest.raises(ValidationError) as captured:
        WorkflowInvocationCreateRequestV2.model_validate(body)
    request = Request(
        {
            "type": "http",
            "method": "PUT",
            "path": "/v1/workflow-invocations/40000000-0000-4000-8000-000000000001",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("test", 80),
            "client": ("test", 1),
        }
    )
    response = await _validation_error_handler(
        request,
        RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in captured.value.errors()]
        ),
    )
    encoded = response.body.decode("utf-8")
    assert response.status_code == 422
    assert "ARGUMENT_VALUE_MUST_NOT_LEAK" not in encoded
    assert "[redacted]" in encoded
