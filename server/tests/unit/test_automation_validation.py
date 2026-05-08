import pytest

from proliferate.server.automations.domain.validation import (
    bounded_run_list_limit,
    normalize_agent_kind,
    normalize_execution_target,
    normalize_optional_text,
    normalize_reasoning_effort,
    normalize_repo_part,
    normalize_required_text,
    require_agent_kind,
)
from proliferate.server.automations.errors import (
    AutomationAgentRequired,
    AutomationInvalidAgentKind,
    AutomationInvalidExecutionTarget,
    AutomationInvalidField,
    AutomationInvalidReasoningEffort,
)


def test_normalize_required_text_trims_and_rejects_empty() -> None:
    assert normalize_required_text("  ship it  ", field_name="prompt") == "ship it"

    with pytest.raises(AutomationInvalidField) as exc:
        normalize_required_text("  ", field_name="prompt")

    assert exc.value.code == "automation_invalid_field"
    assert exc.value.message == "prompt is required."


def test_normalize_required_text_enforces_max_length() -> None:
    with pytest.raises(AutomationInvalidField) as exc:
        normalize_required_text("abcd", field_name="title", max_length=3)

    assert exc.value.message == "title must be at most 3 characters."


def test_normalize_optional_text_collapses_blank_and_enforces_length() -> None:
    assert normalize_optional_text(None, field_name="modeId") is None
    assert normalize_optional_text("  ", field_name="modeId") is None
    assert normalize_optional_text(" auto ", field_name="modeId") == "auto"

    with pytest.raises(AutomationInvalidField):
        normalize_optional_text("x" * 256, field_name="modeId")


def test_normalize_repo_part_uses_repo_length_policy() -> None:
    assert normalize_repo_part(" proliferate-ai ", field_name="gitOwner") == "proliferate-ai"

    with pytest.raises(AutomationInvalidField):
        normalize_repo_part("x" * 256, field_name="gitOwner")


def test_normalize_execution_target() -> None:
    assert normalize_execution_target("cloud") == "cloud"
    assert normalize_execution_target("local") == "local"

    with pytest.raises(AutomationInvalidExecutionTarget) as exc:
        normalize_execution_target("desktop")

    assert exc.value.code == "automation_invalid_execution_target"


def test_normalize_agent_kind() -> None:
    assert normalize_agent_kind(None) is None
    assert normalize_agent_kind(" codex ") == "codex"

    with pytest.raises(AutomationInvalidAgentKind):
        normalize_agent_kind("unsupported")


def test_normalize_reasoning_effort() -> None:
    assert normalize_reasoning_effort(None) is None
    assert normalize_reasoning_effort(" medium ") == "medium"

    with pytest.raises(AutomationInvalidReasoningEffort):
        normalize_reasoning_effort("maximum")


def test_require_agent_kind_for_supported_targets() -> None:
    require_agent_kind("cloud", "codex")
    require_agent_kind("local", "claude")

    with pytest.raises(AutomationAgentRequired):
        require_agent_kind("cloud", None)


def test_bounded_run_list_limit() -> None:
    assert bounded_run_list_limit(-1) == 1
    assert bounded_run_list_limit(50) == 50
    assert bounded_run_list_limit(500) == 100
