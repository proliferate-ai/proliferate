from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.requests import Request

from proliferate.main import _validation_error_handler, create_app
from proliferate.server.catalogs.models import AgentCatalogResponse
from proliferate.server.workflows.domain.invocation import (
    build_portable_definition,
    canonical_json,
    collect_run_eligibility_blockers,
    validate_invocation_arguments,
)
from proliferate.server.workflows.models import WorkflowInvocationCreateRequest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE = REPO_ROOT / "fixtures/contracts/workflow-portable-execution/v1.json"


def _catalog() -> AgentCatalogResponse:
    return AgentCatalogResponse.model_validate(
        {
            "schemaVersion": 2,
            "catalogVersion": "workflow-invocation-test",
            "generatedAt": "2026-07-14T00:00:00Z",
            "agents": [
                {
                    "kind": "claude",
                    "displayName": "Claude",
                    "harness": {"agentProcess": {"version": "test"}},
                    "authContexts": [{"id": "baseline"}],
                    "session": {
                        "supportsGoals": True,
                        "controls": [
                            {
                                "key": "effort",
                                "values": ["low", "high"],
                                "mapping": {"liveConfigId": "effort"},
                            }
                        ],
                        "models": [
                            {
                                "id": "sonnet",
                                "displayName": "Sonnet",
                                "aliases": ["claude-sonnet"],
                                "availability": {"anyOf": ["baseline"]},
                                "defaultVisible": True,
                                "controls": {"effort": {"values": ["low", "high"]}},
                                "status": "active",
                            }
                        ],
                    },
                    "provenance": {"probedAt": "2026-07-14T00:00:00Z"},
                }
            ],
        }
    )


def _number_definition() -> dict[str, object]:
    return {
        "inputs": [{"name": "value", "type": "number", "required": True}],
        "stages": [
            {
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelSelection": {"kind": "targetDefault"},
                    "permissionPolicy": "workflowDefault",
                },
                "steps": [{"kind": "agent.prompt", "prompt": "Use {{inputs.value}}"}],
            }
        ],
    }


def test_shared_number_fixture_is_canonical_and_portable() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in fixture["canonicalNumberCases"]:
        value = json.loads(case["source"])
        if case["portable"]:
            assert canonical_json(value) == case["canonical"]
            validate_invocation_arguments(_number_definition(), {"value": value})
        else:
            with pytest.raises(ValueError):
                validate_invocation_arguments(_number_definition(), {"value": value})


def test_invocation_wire_requires_arguments_but_leaves_portability_to_domain() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    body = {
        "schemaVersion": 1,
        "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
        "expectedRevision": 1,
        "arguments": {"value": 9_007_199_254_740_992},
        "target": {"kind": "managedCloud"},
    }
    parsed = WorkflowInvocationCreateRequest.model_validate(body)
    assert parsed.arguments["value"] == 9_007_199_254_740_992
    body.pop("arguments")
    with pytest.raises(ValidationError):
        WorkflowInvocationCreateRequest.model_validate(body)
    assert (
        fixture["anyHarnessRequest"]["definition"]["stages"][0]["harnessConfig"]["modelSelection"][
            "modelId"
        ]
        == "claude-sonnet-4-5"
    )


@pytest.mark.parametrize("value", [True, 1.0, "1"])
def test_invocation_schema_version_requires_exact_integer(value: object) -> None:
    with pytest.raises(ValidationError):
        WorkflowInvocationCreateRequest.model_validate(
            {
                "schemaVersion": value,
                "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
                "expectedRevision": 1,
                "arguments": {},
                "target": {"kind": "managedCloud"},
            }
        )


def test_eligibility_collects_every_closed_blocker_in_stable_order() -> None:
    stages = (
        {
            "harnessConfig": {
                "agentKind": "claude",
                "modelId": "missing",
                "effort": "impossible",
            },
            "steps": [
                {"kind": "agent.prompt", "prompt": "one", "goal": {"objective": "g"}},
                {"kind": "agent.prompt", "prompt": "two"},
            ],
        },
        {
            "harnessConfig": {"agentKind": "unknown"},
            "steps": [],
        },
    )
    blockers = collect_run_eligibility_blockers(
        _catalog(),
        stages=stages,
        default_repo_config_id="repo",
        default_repository_available=False,
    )
    assert [blocker.code for blocker in blockers] == [
        "default_repository_unavailable",
        "stage_count_not_supported",
        "effort_catalog_selection_unavailable",
        "model_catalog_selection_unavailable",
        "step_count_not_supported",
        "goal_not_supported",
        "agent_catalog_selection_unavailable",
        "step_count_not_supported",
    ]
    assert list(blockers) == sorted(blockers, key=lambda blocker: (blocker.path, blocker.code))


def test_portable_definition_omits_effort_and_canonicalizes_exact_model() -> None:
    definition = build_portable_definition(
        _catalog(),
        inputs=(),
        stages=(
            {
                "harnessConfig": {"agentKind": "claude", "modelId": "claude-sonnet"},
                "steps": [{"kind": "agent.prompt", "prompt": "Inspect."}],
            },
        ),
    )
    harness = definition["stages"][0]["harnessConfig"]  # type: ignore[index]
    assert harness == {
        "agentKind": "claude",
        "modelSelection": {"kind": "exact", "modelId": "sonnet"},
        "permissionPolicy": "workflowDefault",
    }


def test_portable_definition_preserves_exact_model_effort() -> None:
    definition = build_portable_definition(
        _catalog(),
        inputs=(),
        stages=(
            {
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelId": "claude-sonnet",
                    "effort": "high",
                },
                "steps": [{"kind": "agent.prompt", "prompt": "Inspect."}],
            },
        ),
    )
    assert definition["stages"][0]["harnessConfig"] == {  # type: ignore[index]
        "agentKind": "claude",
        "modelSelection": {"kind": "exact", "modelId": "sonnet"},
        "effort": "high",
        "permissionPolicy": "workflowDefault",
    }


def _argument_definition(*, prompt: str) -> dict[str, object]:
    return {
        "inputs": [
            {"name": "required", "type": "string", "required": True},
            {"name": "count", "type": "number", "required": False},
            {"name": "enabled", "type": "boolean", "required": False},
            {"name": "note", "type": "string", "required": False},
        ],
        "stages": [
            {
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelSelection": {"kind": "targetDefault"},
                    "permissionPolicy": "workflowDefault",
                },
                "steps": [{"kind": "agent.prompt", "prompt": prompt}],
            }
        ],
    }


@pytest.mark.parametrize(
    ("arguments", "message"),
    [
        ({}, "required input 'required' has no argument"),
        (
            {"required": "ok", "extra": "no"},
            "argument 'extra' is not a declared input",
        ),
        ({"required": 1}, "argument 'required' must be a string"),
        (
            {"required": "ok", "count": True},
            "argument 'count' must be a number",
        ),
        (
            {"required": "ok", "enabled": "yes"},
            "argument 'enabled' must be a boolean",
        ),
    ],
)
def test_invocation_arguments_reject_missing_extra_and_wrong_types(
    arguments: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message.replace("'", "\\'")):
        validate_invocation_arguments(  # type: ignore[arg-type]
            _argument_definition(prompt="Use {{inputs.required}}"),
            arguments,
        )


def test_optional_input_is_required_only_when_referenced() -> None:
    arguments = {"required": "ok"}
    validate_invocation_arguments(
        _argument_definition(prompt="Use {{inputs.required}}"),
        arguments,
    )  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="prompt input 'note' has no argument"):
        validate_invocation_arguments(
            _argument_definition(prompt="Use {{inputs.required}} {{inputs.note}}"),
            arguments,
        )  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "body",
    [
        {
            "schemaVersion": 1,
            "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
            "expectedRevision": 1,
            "arguments": {},
            "target": {"kind": "managedCloud"},
            "unexpected": True,
        },
        {
            "schemaVersion": 1,
            "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
            "expectedRevision": 1,
            "arguments": {},
            "target": {"kind": "managedCloud", "unexpected": True},
        },
    ],
)
def test_invocation_request_rejects_unknown_top_level_and_target_fields(
    body: dict[str, object],
) -> None:
    with pytest.raises(ValidationError) as captured:
        WorkflowInvocationCreateRequest.model_validate(body)
    assert any(error["type"] == "extra_forbidden" for error in captured.value.errors())


def test_invocation_openapi_pins_exact_request_and_response_shapes() -> None:
    schema = create_app().openapi()
    operation = schema["paths"]["/v1/workflow-invocations/{invocation_id}"]
    assert operation["put"]["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/WorkflowInvocationCreateRequest"
    }
    for method in ("put", "get"):
        assert operation[method]["responses"]["200"]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/WorkflowInvocationResponse"
        }
    assert operation["put"]["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/WorkflowInvocationResponse"
    }

    components = schema["components"]["schemas"]
    request = components["WorkflowInvocationCreateRequest"]
    assert request["additionalProperties"] is False
    assert request["required"] == [
        "schemaVersion",
        "workflowDefinitionId",
        "expectedRevision",
        "arguments",
        "target",
    ]
    assert set(request["properties"]) == set(request["required"])
    assert request["properties"]["schemaVersion"]["const"] == 1
    assert request["properties"]["target"] == {
        "$ref": "#/components/schemas/ManagedCloudWorkflowTarget"
    }

    response = components["WorkflowInvocationResponse"]
    assert response["additionalProperties"] is False
    assert set(response["properties"]) == {
        "id",
        "schemaVersion",
        "workflowDefinitionId",
        "definitionRevision",
        "title",
        "description",
        "definition",
        "arguments",
        "placement",
        "target",
        "createdAt",
    }
    assert set(response["required"]) == set(response["properties"])
    assert components["ManagedCloudWorkflowTarget"]["additionalProperties"] is False
    assert components["ManagedCloudWorkflowTarget"]["properties"]["kind"]["const"] == (
        "managedCloud"
    )


@pytest.mark.asyncio
async def test_workflow_invocation_422_redacts_argument_values_only_for_this_route() -> None:
    body = {
        "schemaVersion": 1,
        "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
        "expectedRevision": 1,
        "arguments": {"ticket": ["ARGUMENT_VALUE_MUST_NOT_LEAK"]},
        "target": {"kind": "managedCloud"},
    }
    with pytest.raises(ValidationError) as captured:
        WorkflowInvocationCreateRequest.model_validate(body)
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
