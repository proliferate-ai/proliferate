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
        with pytest.raises(ValidationError) as excinfo:
            WorkflowDefinitionDocumentV2.model_validate(fixture["definition"])
        expected_path = fixture.get("expectedIssuePath")
        if expected_path is not None:
            locs = {
                ".".join(str(part) for part in error["loc"]) for error in excinfo.value.errors()
            }
            assert expected_path in locs, f"{path.stem}: {expected_path!r} not in {locs}"
        return
    assert rejected_by == "structure"
    document = WorkflowDefinitionDocumentV2.model_validate(fixture["definition"])
    issue = validate_definition_v2_document(document)
    assert issue is not None, f"{path.stem} unexpectedly validated"
    assert issue.path == fixture["expectedIssuePath"]
    if path.stem.startswith("v2-invalid-ref-"):
        assert "malformed" in issue.message, f"{path.stem}: {issue.message}"


def test_run_snapshot_fixture_parses_as_frozen_invocation() -> None:
    fixture = _load("run-snapshot-v2.json")
    response = WorkflowInvocationResponseV2.model_validate(fixture)
    assert response.schema_version == 2
    assert response.placement.mode == "worktree"
    assert validate_definition_v2_document(response.definition) is None
    # The fixture is the frozen/delivered form, so it round-trips through
    # `frozen_json` — the dump whose definition omits empty control values.
    assert response.frozen_json() == fixture


def test_empty_control_values_stay_omitted_in_the_stored_form() -> None:
    """An explicit `controlValues: {}` (what pre-fix saves stored) normalizes
    to an absent key, so the stored/frozen document matches what the runtime
    serializer would emit and never carries a field the author left out."""
    document = WorkflowDefinitionDocumentV2.model_validate(
        {
            "schemaVersion": 2,
            "nodes": [
                {
                    "id": "n_only",
                    "type": "agent",
                    "title": "Do the job",
                    "prompt": "Do the job.",
                    "model": {
                        "agentKind": "codex",
                        "modelId": "codex-large",
                        "controlValues": {},
                    },
                }
            ],
        }
    )
    assert document.document_json() == {
        "schemaVersion": 2,
        "nodes": [
            {
                "id": "n_only",
                "type": "agent",
                "title": "Do the job",
                "prompt": "Do the job.",
                "model": {"agentKind": "codex", "modelId": "codex-large"},
            }
        ],
        "edges": [],
        "inputs": [],
        "docTemplates": [],
    }


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


def _single_node_document(prompt: str) -> WorkflowDefinitionDocumentV2:
    return WorkflowDefinitionDocumentV2.model_validate(
        {
            "schemaVersion": 2,
            "nodes": [{"id": "n_a", "type": "agent", "title": "T", "prompt": prompt}],
            "inputs": [{"name": "topic", "required": True}],
            "docTemplates": [
                {"slug": "research-findings", "producingNodeId": "n_a", "body": "# F\n"}
            ],
        }
    )


@pytest.mark.parametrize(
    ("prompt", "fragment"),
    [
        # Scan-then-validate (Ruling C, amended C.1): a reference attempt is a
        # case-insensitive sigil plus a run of non-space non-@ characters;
        # trailing prose punctuation peels before grammar validation. A token
        # failing the grammar after the peel, a wrong-case sigil, or an empty
        # token is a malformed-reference error, never a silent non-match or
        # prefix match.
        (
            "See @doc:Research-Findings for details",
            "malformed @doc: reference 'Research-Findings'",
        ),
        ("See @doc:research-findings-EXTRA now", "malformed @doc: reference"),
        ("Use @input:my-topic here", "malformed @input: reference 'my-topic'"),
        ("Use @input:_topic here", "malformed @input: reference '_topic'"),
        ("Write @doc:research_findings today", "malformed @doc: reference 'research_findings'"),
        ("See @doc:plan.md today", "malformed @doc: reference 'plan.md'"),
        ("Research @INPUT:topic today", "malformed @input: reference '@INPUT:topic'"),
        ("Check the @doc: carefully", "malformed @doc: reference with an empty token"),
    ],
)
def test_malformed_references_are_errors_not_non_matches(prompt: str, fragment: str) -> None:
    issue = validate_definition_v2_document(_single_node_document(prompt))
    assert issue is not None, prompt
    assert issue.path == "nodes.0.prompt"
    assert fragment in issue.message


@pytest.mark.parametrize(
    "prompt",
    [
        # C.1: sentence punctuation directly after a reference peels away.
        "Research @input:topic. Then write @doc:research-findings.",
        'Cite "@input:topic" and (@doc:research-findings), please…',
        # Back-to-back references parse individually (capture stops at @).
        "Merge @doc:research-findings@doc:research-findings now",
    ],
)
def test_prose_punctuation_and_adjacency_stay_valid(prompt: str) -> None:
    assert validate_definition_v2_document(_single_node_document(prompt)) is None


def test_valid_refs_fixture_validates_clean() -> None:
    fixture = _load("v2-valid-refs.json")
    definition = fixture["definition"]
    assert isinstance(definition, dict)
    document = WorkflowDefinitionDocumentV2.model_validate(definition)
    assert validate_definition_v2_document(document) is None


def test_wellformed_references_still_distinguish_undeclared() -> None:
    issue = validate_definition_v2_document(
        _single_node_document("Research @input:topic into @doc:missing-doc please")
    )
    assert issue is not None
    assert "undeclared doc 'missing-doc'" in issue.message
    assert (
        validate_definition_v2_document(
            _single_node_document("Research @input:topic into @doc:research-findings please")
        )
        is None
    )
