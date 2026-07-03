"""Strict workflow-definition validation (spec 3.3)."""

from __future__ import annotations

import copy

import pytest

from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)


def _valid_definition() -> dict:
    return {
        "args": [
            {"name": "issue", "type": "string", "required": True},
            {"name": "tries", "type": "number", "default": 3},
            {"name": "env", "type": "enum", "enum": ["prod", "staging"], "default": "staging"},
        ],
        "setup": {"harness": "claude", "model": "sonnet", "session_binding": "fresh"},
        "steps": [
            {
                "kind": "agent.prompt",
                "prompt": "Fix {{args.issue}} in {{args.env}}",
                "goal": {
                    "objective": "tests green for {{args.issue}}",
                    "max_turns": 25,
                    "max_wall_secs": 5400,
                    "on_blocked": "pause_for_approval",
                    "verify": {"shell": "make test", "expect_exit": 0},
                },
            },
            {"kind": "shell.run", "command": "make test", "output_name": "test"},
            {
                "kind": "notify",
                "channel": "in_app",
                "message": "done: {{steps[1].output.test}}",
                "on_fail": {"kind": "continue"},
            },
        ],
    }


def test_parse_valid_definition_returns_canonical_and_specs() -> None:
    canonical, specs = parse_definition(_valid_definition())
    assert [s.name for s in specs] == ["issue", "tries", "env"]
    assert canonical["setup"] == {
        "harness": "claude",
        "model": "sonnet",
        "session_binding": "fresh",
    }
    # on_fail defaults to stop when omitted.
    assert canonical["steps"][0]["on_fail"] == {"kind": "stop"}
    assert canonical["steps"][2]["on_fail"] == {"kind": "continue"}


def test_default_session_binding_is_fresh() -> None:
    definition = _valid_definition()
    del definition["setup"]["session_binding"]
    canonical, _ = parse_definition(definition)
    assert canonical["setup"]["session_binding"] == "fresh"


def test_unknown_top_level_key_rejected() -> None:
    definition = _valid_definition()
    definition["extra"] = 1
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


def test_unknown_step_kind_rejected() -> None:
    definition = _valid_definition()
    definition["steps"][0]["kind"] = "agent.magic"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_step_kind"


def test_unknown_step_field_rejected() -> None:
    definition = _valid_definition()
    definition["steps"][1]["nonsense"] = True
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


def test_empty_steps_rejected() -> None:
    definition = _valid_definition()
    definition["steps"] = []
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_empty_steps_allowed_as_draft() -> None:
    # Saving a workflow permits a zero-step draft (built in the editor after
    # create); running it still requires steps.
    definition = _valid_definition()
    definition["steps"] = []
    canonical, _specs = parse_definition(definition, require_steps=False)
    assert canonical["steps"] == []
    # Omitted steps key is also tolerated for drafts.
    del definition["steps"]
    canonical2, _ = parse_definition(definition, require_steps=False)
    assert canonical2["steps"] == []


def test_arg_reference_to_unknown_arg_rejected() -> None:
    definition = _valid_definition()
    definition["steps"][0]["prompt"] = "hi {{args.nope}}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_arg_reference"


def test_forward_step_reference_rejected() -> None:
    definition = _valid_definition()
    # Step 0 cannot reference the output of step 1 (does not run before it).
    definition["steps"][0]["prompt"] = "use {{steps[1].output.test}}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "forward_step_reference"


def test_self_step_reference_rejected() -> None:
    definition = _valid_definition()
    definition["steps"][1]["command"] = "echo {{steps[1].output.test}}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "forward_step_reference"


def test_malformed_reference_rejected() -> None:
    definition = _valid_definition()
    definition["steps"][0]["prompt"] = "hi {{ args . issue }}"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "invalid_template_reference"


def test_enum_arg_requires_enum_list() -> None:
    definition = _valid_definition()
    definition["args"][2] = {"name": "env", "type": "enum"}
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_enum_default_must_be_allowed() -> None:
    definition = _valid_definition()
    definition["args"][2]["default"] = "dev"
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_non_enum_arg_rejects_enum_field() -> None:
    definition = _valid_definition()
    definition["args"][0]["enum"] = ["a", "b"]
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


def test_duplicate_arg_name_rejected() -> None:
    definition = _valid_definition()
    definition["args"].append({"name": "issue", "type": "string"})
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "duplicate_arg"


def test_on_fail_retry_requires_positive_n() -> None:
    definition = _valid_definition()
    definition["steps"][1]["on_fail"] = {"kind": "retry"}
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)

    definition["steps"][1]["on_fail"] = {"kind": "retry", "n": 2}
    canonical, _ = parse_definition(definition)
    assert canonical["steps"][1]["on_fail"] == {"kind": "retry", "n": 2}


def test_goal_requires_caps_and_on_blocked() -> None:
    definition = _valid_definition()
    del definition["steps"][0]["goal"]["max_turns"]
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_notify_channel_validated() -> None:
    definition = _valid_definition()
    definition["steps"][2]["channel"] = "email"
    with pytest.raises(WorkflowDefinitionError):
        parse_definition(definition)


def test_human_approval_step_parses() -> None:
    definition = _valid_definition()
    definition["steps"].append(
        {"kind": "human.approval", "message": "ship?", "on_timeout": "fail", "timeout_secs": 600}
    )
    canonical, _ = parse_definition(definition)
    assert canonical["steps"][3]["kind"] == "human.approval"
    assert canonical["steps"][3]["on_timeout"] == "fail"


def test_scm_open_pr_step_parses() -> None:
    definition = _valid_definition()
    definition["steps"].append(
        {"kind": "scm.open_pr", "title": "Fix {{args.issue}}", "base": "main", "draft": True}
    )
    canonical, _ = parse_definition(definition)
    assert canonical["steps"][3]["title"] == "Fix {{args.issue}}"
    assert canonical["steps"][3]["draft"] is True


def test_parse_does_not_mutate_input() -> None:
    definition = _valid_definition()
    before = copy.deepcopy(definition)
    parse_definition(definition)
    assert definition == before


# --- agent.config step (agent/model config is its own step) --------------------


@pytest.mark.parametrize(
    "config",
    [
        {"kind": "agent.config", "harness": "codex"},
        {"kind": "agent.config", "model": "opus"},
        {"kind": "agent.config", "harness": "codex", "model": "opus"},
    ],
)
def test_agent_config_step_parses(config: dict) -> None:
    definition = _valid_definition()
    definition["steps"].insert(0, config)
    canonical, _ = parse_definition(definition)
    step = canonical["steps"][0]
    assert step["kind"] == "agent.config"
    assert step["on_fail"] == {"kind": "stop"}
    for key in ("harness", "model"):
        if key in config:
            assert step[key] == config[key]
        else:
            assert key not in step


def test_agent_config_requires_harness_or_model() -> None:
    definition = _valid_definition()
    definition["steps"].insert(0, {"kind": "agent.config"})
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "invalid_definition"


def test_agent_config_rejects_empty_harness() -> None:
    definition = _valid_definition()
    definition["steps"].insert(0, {"kind": "agent.config", "harness": "  "})
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "invalid_definition"


def test_agent_config_rejects_unknown_field() -> None:
    definition = _valid_definition()
    definition["steps"].insert(0, {"kind": "agent.config", "harness": "codex", "temperature": 1})
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


@pytest.mark.parametrize("field", ["model_override", "harness_override"])
def test_agent_prompt_rejects_removed_overrides(field: str) -> None:
    definition = _valid_definition()
    definition["steps"][0][field] = "opus"
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"
