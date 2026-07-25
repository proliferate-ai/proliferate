"""Pure invocation-domain rules: arguments, interpolation, ingress canonicality."""

from __future__ import annotations

from uuid import UUID

from proliferate.utils import canonical_json as canonical
from proliferate.server.workflows.domain.invocation import (
    InvocationIssue,
    ResolvedArguments,
    build_resolved_bundle,
    repository_identity,
    request_hash,
    resolve_stages,
    validate_arguments,
    validate_request_canonicalizable,
)

_DECLARATION: list[dict[str, object]] = [
    {"name": "ticket", "type": "string", "required": True},
    {"name": "attempts", "type": "number", "required": False},
    {"name": "dryRun", "type": "boolean", "required": False},
]


def _stages(prompt: str, objective: str | None = None) -> list[dict[str, object]]:
    step: dict[str, object] = {"kind": "agent.prompt", "prompt": prompt}
    if objective is not None:
        step["goal"] = {"objective": objective}
    return [
        {
            "harnessConfig": {"agentKind": "claude", "modelId": "sonnet", "effort": "high"},
            "steps": [step],
        }
    ]


class TestValidateArguments:
    def test_accepts_declared_scalars(self) -> None:
        result = validate_arguments(
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1", "attempts": 3, "dryRun": True},
        )
        assert isinstance(result, ResolvedArguments)
        assert result.arguments == {"ticket": "PRO-1", "attempts": 3, "dryRun": True}

    def test_unknown_argument_rejected(self) -> None:
        result = validate_arguments(
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1", "nope": "x"},
        )
        assert isinstance(result, InvocationIssue)
        assert result.code == "workflow_input_unknown"
        assert result.path == "inputs.nope"

    def test_missing_required_rejected(self) -> None:
        result = validate_arguments(inputs_declaration=_DECLARATION, arguments={})
        assert isinstance(result, InvocationIssue)
        assert result.code == "workflow_input_missing"

    def test_type_mismatch_rejected(self) -> None:
        result = validate_arguments(
            inputs_declaration=_DECLARATION,
            arguments={"ticket": 7},
        )
        assert isinstance(result, InvocationIssue)
        assert result.code == "workflow_input_type_mismatch"

    def test_boolean_is_not_a_number(self) -> None:
        result = validate_arguments(
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1", "attempts": True},
        )
        assert isinstance(result, InvocationIssue)
        assert result.code == "workflow_input_type_mismatch"

    def test_non_finite_number_rejected(self) -> None:
        result = validate_arguments(
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1", "attempts": float("nan")},
        )
        assert isinstance(result, InvocationIssue)
        assert result.code == "workflow_input_number_not_finite"

    def test_integer_beyond_exact_range_rejected(self) -> None:
        result = validate_arguments(
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1", "attempts": 2**53 + 1},
        )
        assert isinstance(result, InvocationIssue)
        assert result.code == "workflow_input_number_outside_exact_range"

    def test_exact_range_boundary_accepted(self) -> None:
        result = validate_arguments(
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1", "attempts": 2**53},
        )
        assert isinstance(result, ResolvedArguments)


class TestResolveStages:
    def test_interpolates_string_number_boolean_canonically(self) -> None:
        resolved = resolve_stages(
            stages=_stages(
                "Do {{inputs.ticket}} with {{inputs.attempts}} while {{inputs.dryRun}}.",
            ),
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-9", "attempts": 1e21, "dryRun": False},
        )
        assert isinstance(resolved, list)
        prompt = resolved[0]["steps"][0]["prompt"]  # type: ignore[index]
        assert prompt == "Do PRO-9 with 1e+21 while false."

    def test_single_pass_inserted_text_never_rescanned(self) -> None:
        resolved = resolve_stages(
            stages=_stages("Run {{inputs.ticket}}."),
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "{{inputs.dryRun}}"},
        )
        assert isinstance(resolved, list)
        prompt = resolved[0]["steps"][0]["prompt"]  # type: ignore[index]
        assert prompt == "Run {{inputs.dryRun}}."

    def test_referenced_but_omitted_optional_rejected(self) -> None:
        resolved = resolve_stages(
            stages=_stages("Try {{inputs.attempts}} times."),
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1"},
        )
        assert isinstance(resolved, InvocationIssue)
        assert resolved.code == "workflow_optional_input_reference_missing"

    def test_goal_objective_interpolates(self) -> None:
        resolved = resolve_stages(
            stages=_stages("Investigate {{inputs.ticket}}.", "Diagnose {{inputs.ticket}}."),
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-3"},
        )
        assert isinstance(resolved, list)
        goal = resolved[0]["steps"][0]["goal"]  # type: ignore[index]
        assert goal == {"objective": "Diagnose PRO-3."}

    def test_malformed_template_rejected(self) -> None:
        resolved = resolve_stages(
            stages=_stages("Broken {{inputs.ticket}."),
            inputs_declaration=_DECLARATION,
            arguments={"ticket": "PRO-1"},
        )
        assert isinstance(resolved, InvocationIssue)
        assert resolved.code == "invalid_workflow_definition"


class TestRequestCanonicalizable:
    def test_clean_request_passes(self) -> None:
        assert (
            validate_request_canonicalizable(
                {
                    "definitionId": "x",
                    "expectedRevision": 1,
                    "inputs": {"ticket": "PRO-1", "attempts": 3.5},
                    "target": {"kind": "managedCloud"},
                    "placement": {"kind": "newWorkspace", "repository": {"kind": "none"}},
                }
            )
            is None
        )

    def test_lone_surrogate_in_input_value(self) -> None:
        issue = validate_request_canonicalizable({"inputs": {"ticket": "bad \ud800 text"}})
        assert issue is not None
        assert issue.code == "workflow_request_not_canonical"
        assert issue.path == "inputs.ticket"

    def test_lone_surrogate_in_key(self) -> None:
        issue = validate_request_canonicalizable({"inputs": {"bad\udfffkey": "x"}})
        assert issue is not None
        assert issue.code == "workflow_request_not_canonical"

    def test_lone_surrogate_deep_in_placement(self) -> None:
        issue = validate_request_canonicalizable(
            {"placement": {"kind": "newWorkspace", "baseRef": "\ud800"}}
        )
        assert issue is not None
        assert issue.code == "workflow_request_not_canonical"
        assert issue.path == "placement.baseRef"

    def test_unsafe_integer_in_inputs_keeps_typed_code(self) -> None:
        issue = validate_request_canonicalizable({"inputs": {"attempts": 2**53 + 1}})
        assert issue is not None
        assert issue.code == "workflow_input_number_outside_exact_range"
        assert issue.path == "inputs.attempts"

    def test_unsafe_integer_outside_inputs_is_generic(self) -> None:
        issue = validate_request_canonicalizable({"expectedRevision": 2**53 + 1})
        assert issue is not None
        assert issue.code == "workflow_request_not_canonical"

    def test_non_finite_in_inputs_keeps_typed_code(self) -> None:
        issue = validate_request_canonicalizable({"inputs": {"attempts": float("inf")}})
        assert issue is not None
        assert issue.code == "workflow_input_number_not_finite"

    def test_nested_lists_scanned(self) -> None:
        issue = validate_request_canonicalizable(
            {"placement": {"sessionBindings": [{"sessionId": "\udc00"}]}}
        )
        assert issue is not None
        assert issue.path == "placement.sessionBindings.0.sessionId"


class TestDigests:
    def test_request_hash_is_stable_and_key_order_insensitive(self) -> None:
        definition_id = UUID("20000000-0000-4000-8000-000000000001")
        base = dict(
            definition_id=definition_id,
            expected_revision=3,
            target={"kind": "managedCloud"},
            logical_placement={"kind": "newWorkspace", "repository": {"kind": "none"}},
        )
        first = request_hash(arguments={"a": 1, "b": "x"}, **base)  # type: ignore[arg-type]
        second = request_hash(arguments={"b": "x", "a": 1}, **base)  # type: ignore[arg-type]
        assert first == second
        different = request_hash(arguments={"a": 2, "b": "x"}, **base)  # type: ignore[arg-type]
        assert different != first

    def test_bundle_digest_covers_only_scoped_members(self) -> None:
        bundle = build_resolved_bundle(
            run_id=UUID("10000000-0000-4000-8000-000000000001"),
            definition_id=UUID("20000000-0000-4000-8000-000000000001"),
            definition_revision=3,
            definition_schema_version=1,
            definition_title="Diagnose a ticket",
            definition_default_repo_config_id=None,
            validated_catalog_version="2026-07-12.1",
            inputs_declaration=_DECLARATION,
            stages=_stages("Investigate {{inputs.ticket}}."),
            arguments={"ticket": "PRO-123"},
            resolved_placement={"kind": "newWorkspace", "repository": {"kind": "none"}},
            resolved_stages=_stages("Investigate PRO-123."),
        )
        digest = canonical.bundle_digest(bundle)
        renamed = dict(bundle)
        renamed["runId"] = "10000000-0000-4000-8000-00000000ffff"
        assert canonical.bundle_digest(renamed) == digest
        changed = dict(bundle)
        changed["arguments"] = {"ticket": "PRO-124"}
        assert canonical.bundle_digest(changed) != digest

    def test_repository_identity_rendering(self) -> None:
        assert (
            repository_identity("github", "proliferate-ai", "proliferate")
            == "github:proliferate-ai/proliferate"
        )
