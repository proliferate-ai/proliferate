"""Pure-logic tests for agent-auth selection legality and redacted hints."""

from __future__ import annotations

import uuid

import pytest

from proliferate.db.store.agent_gateway.api_keys import build_redacted_hint
from proliferate.db.store.agent_gateway.records import DesiredAuthSource
from proliferate.server.cloud.agent_gateway.selection_rules import (
    SelectionRuleError,
    validate_auth_selection_set,
)


def _gateway(*, enabled: bool = True) -> DesiredAuthSource:
    return DesiredAuthSource(source_kind="gateway", enabled=enabled)


def _api_key(
    *,
    env_var_name: str = "ANTHROPIC_API_KEY",
    enabled: bool = True,
) -> DesiredAuthSource:
    return DesiredAuthSource(
        source_kind="api_key",
        api_key_id=uuid.uuid4(),
        env_var_name=env_var_name,
        enabled=enabled,
    )


class TestAuthSelectionRules:
    def test_cursor_rejects_any_source(self) -> None:
        with pytest.raises(SelectionRuleError, match="native login only"):
            validate_auth_selection_set(harness_kind="cursor", sources=[_gateway()])
        # Empty is fine — cursor is always the native empty state.
        validate_auth_selection_set(harness_kind="cursor", sources=[])

    def test_single_source_harnesses_allow_at_most_one_enabled(self) -> None:
        for harness in ("claude", "codex", "grok"):
            validate_auth_selection_set(harness_kind=harness, sources=[_gateway()])
            validate_auth_selection_set(harness_kind=harness, sources=[_api_key()])
            # Gateway enabled + a disabled api_key is still one enabled source.
            validate_auth_selection_set(
                harness_kind=harness,
                sources=[_gateway(), _api_key(enabled=False)],
            )
            with pytest.raises(SelectionRuleError, match="at most one enabled"):
                validate_auth_selection_set(
                    harness_kind=harness,
                    sources=[_gateway(), _api_key()],
                )

    def test_opencode_composes_gateway_plus_many_api_keys(self) -> None:
        validate_auth_selection_set(
            harness_kind="opencode",
            sources=[
                _gateway(),
                _api_key(env_var_name="ANTHROPIC_API_KEY"),
                _api_key(env_var_name="OPENAI_API_KEY"),
            ],
        )

    def test_gateway_source_rejected_for_non_gateway_capable_harness(self) -> None:
        with pytest.raises(SelectionRuleError, match="no gateway recipe"):
            validate_auth_selection_set(
                harness_kind="mystery",
                sources=[_gateway()],
            )

    def test_env_var_name_shape_is_enforced(self) -> None:
        validate_auth_selection_set(
            harness_kind="claude",
            sources=[_api_key(env_var_name="ANTHROPIC_API_KEY")],
        )
        for bad in ("anthropic_api_key", "1KEY", "KEY-NAME", "", "A" * 129, "KEY NAME"):
            with pytest.raises(SelectionRuleError, match="env var name"):
                validate_auth_selection_set(
                    harness_kind="claude",
                    sources=[_api_key(env_var_name=bad)],
                )

    def test_env_var_name_max_length_boundary(self) -> None:
        # 1 leading letter + 127 tail chars = 128, the inclusive maximum.
        validate_auth_selection_set(
            harness_kind="claude",
            sources=[_api_key(env_var_name="A" + "B" * 127)],
        )


class TestRedactedHint:
    def test_prefixed_key_keeps_prefix_and_tail(self) -> None:
        assert build_redacted_hint("sk-ant-api03-abcdefabc4") == "sk-...abc4"

    def test_short_key_is_not_over_redacted(self) -> None:
        assert build_redacted_hint("abc") == "...abc"

    def test_unprefixed_key_shows_tail_only(self) -> None:
        assert build_redacted_hint("0123456789abcdefwxyz") == "...wxyz"

    def test_hint_never_contains_middle_of_key(self) -> None:
        value = "sk-proj-SECRETMIDDLEPARTxyz9"
        hint = build_redacted_hint(value)
        assert "SECRETMIDDLEPART" not in hint
        assert hint.endswith("xyz9")
