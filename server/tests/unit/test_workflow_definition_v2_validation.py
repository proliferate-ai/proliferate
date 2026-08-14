"""Fixture-driven validation for gen-2 workflow definition documents.

Consumer half of ``fixtures/contracts/workflow-definition/v2-*.json``. The
runtime plane consumes the same fixtures (PR3) so the two validators stay in
lockstep: ``rejectedBy: "shape"`` cases must fail wire-model parsing,
``rejectedBy: "structure"`` cases must parse and then fail the pure
cross-field validator at exactly ``expectedIssuePath``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from proliferate.server.workflows.domain.validation_v2 import (
    validate_definition_v2_document,
)
from proliferate.server.workflows.models_v2 import (
    WorkflowDefinitionDocumentV2,
    WorkflowDefinitionResponseV2,
    WorkflowInvocationResponseV2,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "contracts" / "workflow-definition"

INVALID_FIXTURES = sorted(FIXTURE_ROOT.glob("v2-invalid-*.json"))


def _load(name: str) -> dict[str, object]:
    return json.loads((FIXTURE_ROOT / name).read_text())


def test_v2_full_fixture_parses_and_validates() -> None:
    fixture = _load("v2-full.json")
    response = WorkflowDefinitionResponseV2.model_validate(fixture)
    assert response.schema_version == 2
    assert validate_definition_v2_document(response.definition) is None
    # The stored form round-trips byte-identically through the wire model.
    assert response.definition.document_json() == fixture["definition"]


def test_v2_minimal_fixture_parses_and_validates() -> None:
    fixture = _load("v2-minimal.json")
    response = WorkflowDefinitionResponseV2.model_validate(fixture)
    assert validate_definition_v2_document(response.definition) is None
    assert response.definition.edges == []
    assert response.definition.inputs == []
    assert response.definition.doc_templates == []


def test_invalid_fixture_list_is_nonempty() -> None:
    assert len(INVALID_FIXTURES) >= 10


@pytest.mark.parametrize("path", INVALID_FIXTURES, ids=lambda path: path.stem)
def test_invalid_fixtures_are_rejected(path: Path) -> None:
    fixture = json.loads(path.read_text())
    rejected_by = fixture["rejectedBy"]
    if rejected_by == "shape":
        with pytest.raises(ValidationError):
            WorkflowDefinitionDocumentV2.model_validate(fixture["definition"])
        return
    assert rejected_by == "structure"
    document = WorkflowDefinitionDocumentV2.model_validate(fixture["definition"])
    issue = validate_definition_v2_document(document)
    assert issue is not None, f"{path.stem} unexpectedly validated"
    assert issue.path == fixture["expectedIssuePath"]


def test_run_snapshot_fixture_parses_as_frozen_invocation() -> None:
    fixture = _load("run-snapshot-v2.json")
    response = WorkflowInvocationResponseV2.model_validate(fixture)
    assert response.schema_version == 2
    assert response.placement.mode == "worktree"
    assert validate_definition_v2_document(response.definition) is None
    round_tripped = response.model_dump(by_alias=True, mode="json", exclude_none=True)
    assert round_tripped == fixture


def test_schema_version_must_be_exact_integer() -> None:
    minimal = _load("v2-minimal.json")["definition"]
    assert isinstance(minimal, dict)
    with pytest.raises(ValidationError):
        WorkflowDefinitionDocumentV2.model_validate({**minimal, "schemaVersion": "2"})
    with pytest.raises(ValidationError):
        WorkflowDefinitionDocumentV2.model_validate({**minimal, "schemaVersion": 1})


def test_single_node_with_stray_edge_is_rejected() -> None:
    document = WorkflowDefinitionDocumentV2.model_validate(
        {
            "schemaVersion": 2,
            "nodes": [{"id": "n_a", "type": "agent", "title": "T", "prompt": "Run."}],
            "edges": [{"from": "n_a", "to": "n_a"}],
        }
    )
    issue = validate_definition_v2_document(document)
    assert issue is not None
    assert issue.path == "edges"
