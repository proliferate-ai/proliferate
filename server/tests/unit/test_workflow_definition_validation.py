from __future__ import annotations

import json
from pathlib import Path

import pytest

from proliferate.server.workflows.domain.validation import (
    DefinitionIssue,
    ValidatedDefinitionDocument,
    validate_definition_document,
)
from proliferate.server.workflows.models import WorkflowDefinitionResponse

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "contracts" / "workflow-definition"


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
def test_saved_launch_intent_does_not_require_catalog_membership(
    agent_kind: str,
    model_id: str,
    effort: str,
) -> None:
    result = validate_definition_document(
        inputs=_inputs("ticket"),
        stages=[_stage(agent_kind, model_id=model_id, effort=effort)],
    )

    assert isinstance(result, ValidatedDefinitionDocument)


def test_model_id_is_preserved_without_catalog_canonicalization() -> None:
    stages = [_stage("claude", model_id="claude-sonnet", effort="high")]

    result = validate_definition_document(
        inputs=_inputs("ticket"),
        stages=stages,
    )

    assert isinstance(result, ValidatedDefinitionDocument)
    assert result.stages[0]["harnessConfig"] == {
        "agentKind": "claude",
        "modelId": "claude-sonnet",
        "effort": "high",
    }
    assert stages[0]["harnessConfig"] == {
        "agentKind": "claude",
        "modelId": "claude-sonnet",
        "effort": "high",
    }


def test_goal_intent_is_preserved_for_runtime_capability_validation() -> None:
    result = validate_definition_document(
        inputs=_inputs("ticket"),
        stages=[_stage("cursor", model_id="composer", goal="Resolve the ticket.")],
    )
    assert isinstance(result, ValidatedDefinitionDocument)


def test_raw_effort_intent_is_preserved() -> None:
    result = validate_definition_document(
        inputs=_inputs("ticket"),
        stages=[_stage("cursor", model_id="composer", effort="medium")],
    )

    assert isinstance(result, ValidatedDefinitionDocument)


def test_input_names_must_be_unique() -> None:
    result = validate_definition_document(
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
        inputs=_inputs("ticket"),
        stages=[_stage("claude", model_id="sonnet", prompt=prompt)],
    )

    assert result == DefinitionIssue(
        path="stages.0.steps.0.prompt",
        message=expected_message,
    )
