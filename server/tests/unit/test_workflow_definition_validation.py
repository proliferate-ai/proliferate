from __future__ import annotations

import json
from pathlib import Path

import pytest

from proliferate.server.catalogs.models import AgentCatalogResponse
from proliferate.server.workflows.domain.validation import (
    DefinitionIssue,
    ValidatedDefinitionDocument,
    validate_definition_document,
)
from proliferate.server.workflows.models import WorkflowDefinitionResponse

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "contracts" / "workflow-definition"


def _model(
    model_id: str,
    *,
    aliases: list[str] | None = None,
    controls: dict[str, list[str]] | None = None,
) -> dict[str, object]:
    return {
        "id": model_id,
        "displayName": model_id,
        "aliases": aliases or [],
        "availability": {"anyOf": ["baseline"]},
        "defaultVisible": True,
        "controls": {key: {"values": values} for key, values in (controls or {}).items()},
        "status": "active",
    }


def _agent(
    kind: str,
    *,
    supports_goals: bool,
    controls: list[dict[str, object]],
    models: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "kind": kind,
        "displayName": kind.title(),
        "harness": {"agentProcess": {"version": "test"}},
        "authContexts": [{"id": "baseline"}],
        "session": {
            "supportsGoals": supports_goals,
            "controls": controls,
            "models": models,
        },
        "provenance": {"probedAt": "2026-07-12T00:00:00Z"},
    }


def _catalog() -> AgentCatalogResponse:
    return AgentCatalogResponse.model_validate(
        {
            "schemaVersion": 2,
            "catalogVersion": "test-workflow-catalog",
            "generatedAt": "2026-07-12T00:00:00Z",
            "agents": [
                _agent(
                    "claude",
                    supports_goals=True,
                    controls=[
                        {
                            "key": "effort",
                            "values": ["default", "low", "medium", "high", "xhigh", "max"],
                            "mapping": {"liveConfigId": "effort"},
                        }
                    ],
                    models=[
                        _model(
                            "sonnet",
                            aliases=["claude-sonnet"],
                            controls={"effort": ["default", "low", "medium", "high", "max"]},
                        ),
                        _model("haiku"),
                    ],
                ),
                _agent(
                    "codex",
                    supports_goals=True,
                    controls=[
                        {
                            "key": "reasoning_effort",
                            "values": ["low", "medium", "high", "xhigh", "max", "ultra"],
                            "mapping": {"liveConfigId": "reasoning_effort"},
                        }
                    ],
                    models=[
                        _model(
                            "gpt-5.5",
                            controls={"reasoning_effort": ["low", "medium", "high", "xhigh"]},
                        )
                    ],
                ),
                _agent(
                    "cursor",
                    supports_goals=False,
                    controls=[
                        {
                            "key": "reasoning_effort",
                            "values": ["medium"],
                            "mapping": None,
                        }
                    ],
                    models=[_model("composer", controls={"reasoning_effort": ["medium"]})],
                ),
            ],
        }
    )


def _stage(
    agent_kind: str,
    *,
    model_id: str | None = None,
    effort: str | None = None,
    prompt: str = "Investigate {{inputs.ticket}}.",
    goal: str | None = None,
) -> dict[str, object]:
    harness: dict[str, object] = {"agentKind": agent_kind}
    if model_id is not None:
        harness["modelId"] = model_id
    if effort is not None:
        harness["effort"] = effort
    step: dict[str, object] = {"kind": "agent.prompt", "prompt": prompt}
    if goal is not None:
        step["goal"] = {"objective": goal}
    return {"harnessConfig": harness, "steps": [step]}


def _inputs(*names: str) -> list[dict[str, object]]:
    return [{"name": name, "type": "string", "required": True} for name in names]


@pytest.mark.parametrize("fixture_name", ["minimal.json", "full.json"])
def test_contract_fixture_parses_as_workflow_definition_response(fixture_name: str) -> None:
    payload = json.loads((FIXTURE_ROOT / fixture_name).read_text(encoding="utf-8"))

    parsed = WorkflowDefinitionResponse.model_validate(payload)

    assert parsed.schema_version == 1
    assert parsed.revision >= 1
    assert parsed.validated_catalog_version
    assert parsed.stages
    assert isinstance(parsed.description, str)


@pytest.mark.parametrize(
    ("agent_kind", "model_id", "effort"),
    [
        ("claude", "sonnet", "xhigh"),
        ("claude", "haiku", "high"),
        ("codex", "gpt-5.5", "ultra"),
    ],
)
def test_effort_must_come_from_the_exact_model_matrix(
    agent_kind: str,
    model_id: str,
    effort: str,
) -> None:
    result = validate_definition_document(
        _catalog(),
        inputs=_inputs("ticket"),
        stages=[_stage(agent_kind, model_id=model_id, effort=effort)],
    )

    assert isinstance(result, DefinitionIssue)
    assert result.path == "stages.0.harnessConfig.effort"


def test_alias_is_canonicalized_without_mutating_the_request() -> None:
    stages = [_stage("claude", model_id="claude-sonnet", effort="high")]

    result = validate_definition_document(
        _catalog(),
        inputs=_inputs("ticket"),
        stages=stages,
    )

    assert isinstance(result, ValidatedDefinitionDocument)
    assert result.stages[0]["harnessConfig"] == {
        "agentKind": "claude",
        "modelId": "sonnet",
        "effort": "high",
    }
    assert stages[0]["harnessConfig"] == {
        "agentKind": "claude",
        "modelId": "claude-sonnet",
        "effort": "high",
    }


def test_goal_requires_catalog_capability() -> None:
    unsupported = validate_definition_document(
        _catalog(),
        inputs=_inputs("ticket"),
        stages=[_stage("cursor", model_id="composer", goal="Resolve the ticket.")],
    )
    supported = validate_definition_document(
        _catalog(),
        inputs=_inputs("ticket"),
        stages=[_stage("claude", model_id="sonnet", goal="Resolve {{inputs.ticket}}.")],
    )

    assert unsupported == DefinitionIssue(
        path="stages.0.steps.0.goal",
        message="Cursor does not support workflow goals.",
        kind="catalog_selection_unavailable",
    )
    assert isinstance(supported, ValidatedDefinitionDocument)


def test_raw_effort_metadata_without_application_mapping_is_not_authorable() -> None:
    result = validate_definition_document(
        _catalog(),
        inputs=_inputs("ticket"),
        stages=[_stage("cursor", model_id="composer", effort="medium")],
    )

    assert result == DefinitionIssue(
        path="stages.0.harnessConfig.effort",
        message="Model 'composer' does not expose an authorable effort control.",
        kind="catalog_selection_unavailable",
    )


def test_input_names_must_be_unique() -> None:
    result = validate_definition_document(
        _catalog(),
        inputs=_inputs("ticket", "ticket"),
        stages=[_stage("claude", model_id="sonnet")],
    )

    assert result == DefinitionIssue(
        path="inputs.1.name",
        message="Input name 'ticket' is duplicated.",
    )


@pytest.mark.parametrize(
    ("prompt", "expected_message"),
    [
        ("Investigate {{inputs.missing}}.", "Template references unknown input 'missing'."),
        ("Investigate {{ticket}}.", "Templates may only use the exact form '{{inputs.name}}'."),
        (
            "Investigate {{ inputs.ticket }}.",
            "Templates may only use the exact form '{{inputs.name}}'.",
        ),
        (
            "Investigate {{{inputs.ticket}}}.",
            "Templates may only use the exact form '{{inputs.name}}'.",
        ),
        (
            "Investigate {{inputs.ticket}}}.",
            "Templates may only use the exact form '{{inputs.name}}'.",
        ),
        (
            "Investigate {{{inputs.ticket}}.",
            "Templates may only use the exact form '{{inputs.name}}'.",
        ),
    ],
)
def test_prompt_templates_only_accept_exact_declared_input_references(
    prompt: str,
    expected_message: str,
) -> None:
    result = validate_definition_document(
        _catalog(),
        inputs=_inputs("ticket"),
        stages=[_stage("claude", model_id="sonnet", prompt=prompt)],
    )

    assert result == DefinitionIssue(
        path="stages.0.steps.0.prompt",
        message=expected_message,
    )
