"""Strict workflow-definition validation — format v2 (data-contract §1)."""

from __future__ import annotations

import copy

import pytest

from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)


def _valid_definition() -> dict:
    """A two-node spine covering the v2 kind union, refs, and the emit namespace."""
    return {
        "version": 1,
        "name": "Sentry triage & fix",
        "description": "…",
        "inputs": [
            {"name": "issue", "type": "text", "required": True},
            {"name": "tries", "type": "number", "default": 3},
            {
                "name": "env",
                "type": "choice",
                "choices": ["prod", "staging"],
                "default": "staging",
            },
        ],
        "integrations": ["sentry", "linear", "slack"],
        "agents": [
            {
                "slot": "triage",
                "harness": "claude",
                "model": "claude-sonnet-5",
                "steps": [
                    {
                        "kind": "agent.prompt",
                        "label": "Investigate",
                        "prompt": "Fix {{inputs.issue}} in {{inputs.env}}",
                        "required_invocation": {"provider": "linear", "tool": "update_status"},
                        "goal": {
                            "objective": "tests green for {{inputs.issue}}",
                            "max_turns": 25,
                            "max_wall_secs": 5400,
                            "on_blocked": "pause_for_approval",
                            "verify": {"shell": "make test", "expect_exit": 0},
                        },
                    },
                    {
                        "kind": "agent.emit",
                        "name": "verdict",
                        "prompt": "classify {{inputs.issue}}",
                        "output_schema": {"type": "object"},
                    },
                ],
            },
            {
                "slot": "fix",
                "harness": "claude",
                "model": "claude-opus-4-8",
                "steps": [
                    {"kind": "shell.run", "command": "make test", "output_name": "test"},
                    {
                        "kind": "agent.config",
                        "model": "claude-opus-4-8",
                    },
                    {
                        "kind": "notify",
                        "slack_channel_id": "C123",
                        "message": "root cause: {{verdict.root_cause}}",
                        "on_fail": {"kind": "continue"},
                    },
                    {
                        "kind": "branch",
                        "on": "{{verdict.decision}}",
                        "cases": {"ship": {"to": "continue"}, "wont_fix": {"to": "end"}},
                    },
                ],
            },
        ],
    }


def _first_node(canonical: dict) -> dict:
    return canonical["agents"][0]


# --- shape ---------------------------------------------------------------------


def test_parse_valid_definition_returns_canonical_and_specs() -> None:
    canonical, specs = parse_definition(_valid_definition())
    assert [s.name for s in specs] == ["issue", "tries", "env"]
    assert canonical["version"] == 1
    assert canonical["integrations"] == ["sentry", "linear", "slack"]
    assert [n["slot"] for n in canonical["agents"]] == ["triage", "fix"]
    # on_fail defaults to stop; the continue on the notify step survives.
    assert _first_node(canonical)["steps"][0]["on_fail"] == {"kind": "stop"}
    assert canonical["agents"][1]["steps"][2]["on_fail"] == {"kind": "continue"}


def test_version_must_be_one() -> None:
    definition = _valid_definition()
    definition["version"] = 2
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_setup_and_top_level_steps_are_removed() -> None:
    definition = _valid_definition()
    definition["setup"] = {"harness": "claude", "model": "x"}
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


def test_unknown_top_level_key_rejected() -> None:
    definition = _valid_definition()
    definition["extra"] = 1
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


# --- agents spine (A4) ---------------------------------------------------------


def test_at_least_one_agent_required() -> None:
    definition = _valid_definition()
    definition["agents"] = []
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_empty_agents_allowed_as_draft() -> None:
    definition = _valid_definition()
    definition["agents"] = []
    canonical, _ = parse_definition(definition, require_steps=False)
    assert canonical["agents"] == []


def test_slot_must_match_grammar() -> None:
    definition = _valid_definition()
    definition["agents"][0]["slot"] = "Triage"  # uppercase illegal
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_duplicate_slot_rejected() -> None:
    definition = _valid_definition()
    definition["agents"][1]["slot"] = "triage"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "duplicate_slot"


# --- step-kind union -----------------------------------------------------------


def test_unknown_step_kind_rejected() -> None:
    definition = _valid_definition()
    definition["agents"][0]["steps"][0]["kind"] = "agent.magic"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_step_kind"


def test_human_approval_kind_is_gone() -> None:
    definition = _valid_definition()
    definition["agents"][0]["steps"].append(
        {"kind": "human.approval", "message": "ship?", "on_timeout": "fail"}
    )
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_step_kind"


def test_notify_is_slack_only_no_channel() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"][2]["channel"] = "in_app"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


def test_notify_requires_slack_channel_id() -> None:
    definition = _valid_definition()
    del definition["agents"][1]["steps"][2]["slack_channel_id"]
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_agent_config_narrows_to_model_only() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"][1]["harness"] = "codex"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


def test_agent_config_requires_model() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"][1] = {"kind": "agent.config"}
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_scm_open_pr_step_parses() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"].append(
        {"kind": "scm.open_pr", "title": "Fix {{inputs.issue}}", "base": "main", "draft": True}
    )
    canonical, _ = parse_definition(definition)
    step = canonical["agents"][1]["steps"][-1]
    assert step["title"] == "Fix {{inputs.issue}}"
    assert step["draft"] is True


# --- emit + refs ---------------------------------------------------------------


def test_emit_name_required_and_unique() -> None:
    definition = _valid_definition()
    # duplicate the emit name in the second node
    definition["agents"][1]["steps"].insert(
        0, {"kind": "agent.emit", "name": "verdict", "prompt": "again"}
    )
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "duplicate_emit"


def test_emit_max_attempts_defaults_to_three() -> None:
    canonical, _ = parse_definition(_valid_definition())
    emit = _first_node(canonical)["steps"][1]
    assert emit["name"] == "verdict"
    assert emit["max_attempts"] == 3


def test_emit_name_cannot_be_reserved_segment() -> None:
    definition = _valid_definition()
    definition["agents"][0]["steps"][1]["name"] = "inputs"
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_input_reference_to_unknown_input_rejected() -> None:
    definition = _valid_definition()
    definition["agents"][0]["steps"][0]["prompt"] = "hi {{inputs.nope}}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_input_reference"


def test_forward_emit_reference_rejected() -> None:
    definition = _valid_definition()
    # The triage prompt (before the `verdict` emit) cannot see `verdict`.
    definition["agents"][0]["steps"][0]["prompt"] = "use {{verdict.root_cause}}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "forward_emit_reference"


def test_emit_cannot_reference_itself() -> None:
    definition = _valid_definition()
    definition["agents"][0]["steps"][1]["prompt"] = "self {{verdict.x}}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "forward_emit_reference"


def test_prior_emit_is_visible_across_nodes() -> None:
    # `verdict` (triage node) is visible to the fix node's notify — the baseline
    # definition already exercises this; assert it parses clean.
    parse_definition(_valid_definition())


# --- branch (C11/D3) -----------------------------------------------------------


def test_branch_cases_must_be_continue_or_end() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"][3]["cases"]["ship"] = {"to": "goto_notify"}
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_branch_on_must_be_a_single_emit_ref() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"][3]["on"] = "{{inputs.env}}"
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_branch_on_forward_emit_rejected() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"][3]["on"] = "{{later.x}}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "forward_emit_reference"


# --- inputs schema (E2) --------------------------------------------------------


def test_choice_input_requires_choices_list() -> None:
    definition = _valid_definition()
    definition["inputs"][2] = {"name": "env", "type": "choice"}
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_choice_default_must_be_allowed() -> None:
    definition = _valid_definition()
    definition["inputs"][2]["default"] = "dev"
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_non_choice_input_rejects_choices_field() -> None:
    definition = _valid_definition()
    definition["inputs"][0]["choices"] = ["a", "b"]
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


def test_duplicate_input_name_rejected() -> None:
    definition = _valid_definition()
    definition["inputs"].append({"name": "issue", "type": "text"})
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "duplicate_arg"


# --- on_fail + goal ------------------------------------------------------------


def test_on_fail_retry_requires_positive_n() -> None:
    definition = _valid_definition()
    definition["agents"][1]["steps"][0]["on_fail"] = {"kind": "retry"}
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_goal_requires_caps_and_on_blocked() -> None:
    definition = _valid_definition()
    del definition["agents"][0]["steps"][0]["goal"]["max_turns"]
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_parse_does_not_mutate_input() -> None:
    definition = _valid_definition()
    before = copy.deepcopy(definition)
    parse_definition(definition)
    assert definition == before
