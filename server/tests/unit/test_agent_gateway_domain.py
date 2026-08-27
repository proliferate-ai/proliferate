"""Pure-logic tests for agent-auth selection legality and redacted hints."""

from __future__ import annotations

import uuid

import pytest

from proliferate.db.store.agent_gateway.api_keys import build_redacted_hint
from proliferate.db.store.agent_gateway.records import DesiredAuthSource
from proliferate.server.agent_auth.selection_rules import (
    SelectionRuleError,
    validate_auth_selection_set,
)


def _gateway(*, enabled: bool = True) -> DesiredAuthSource:
    return DesiredAuthSource(source_kind="gateway", enabled=enabled)


def _api_key(
    *,
    env_var_name: str | None = "ANTHROPIC_API_KEY",
    enabled: bool = True,
) -> DesiredAuthSource:
    return DesiredAuthSource(
        source_kind="api_key",
        api_key_id=uuid.uuid4(),
        env_var_name=env_var_name,
        enabled=enabled,
    )


def _seat(
    *,
    api_key_id: uuid.UUID | None = None,
    enabled: bool = True,
) -> DesiredAuthSource:
    return DesiredAuthSource(
        source_kind="seat",
        api_key_id=api_key_id,
        enabled=enabled,
    )


class TestAuthSelectionRules:
    def test_cursor_rejects_gateway_but_allows_api_key(self) -> None:
        # Cursor has no gateway recipe (agent-auth.md: "typed refusal, no
        # gateway route exists for cursor") — a gateway source is illegal.
        with pytest.raises(SelectionRuleError, match="no gateway recipe"):
            validate_auth_selection_set(harness_kind="cursor", sources=[_gateway()])
        # Empty is fine — cursor's implicit native empty state.
        validate_auth_selection_set(harness_kind="cursor", sources=[])
        # Its single api_key slot (CURSOR_API_KEY) IS a legal selection, same
        # cardinality rule as any other single-source harness.
        validate_auth_selection_set(
            harness_kind="cursor",
            sources=[_api_key(env_var_name="CURSOR_API_KEY")],
        )
        with pytest.raises(SelectionRuleError, match="at most one enabled"):
            validate_auth_selection_set(
                harness_kind="cursor",
                sources=[
                    _api_key(env_var_name="CURSOR_API_KEY"),
                    _api_key(env_var_name="CURSOR_API_KEY_2"),
                ],
            )

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

    def test_env_var_name_is_optional_for_typed_vault_references(self) -> None:
        # A source referencing a TYPED vault entry names no env var by law
        # (agent-auth.md: the typed kind carries its own env mapping); the
        # rules layer cannot see vault kinds, so a missing name must pass
        # here — the store's kind-aware gate enforces bare-vs-typed shape.
        validate_auth_selection_set(
            harness_kind="claude",
            sources=[_api_key(env_var_name=None)],
        )

    def test_env_var_name_max_length_boundary(self) -> None:
        # 1 leading letter + 127 tail chars = 128, the inclusive maximum.
        validate_auth_selection_set(
            harness_kind="claude",
            sources=[_api_key(env_var_name="A" + "B" * 127)],
        )

    def test_env_passthrough_form_is_rejected_in_plain_words(self) -> None:
        # The retired env-passthrough form (agent_auth spec ruling): an
        # api_key source naming an env var WITHOUT a vault reference — "use
        # the machine's own value of that variable". THE validator refuses it
        # by name, in plain words, before the store's generic shape error;
        # disabled rows are just as illegal (the shape is unstorable, not
        # merely unlaunchable).
        for enabled in (True, False):
            with pytest.raises(SelectionRuleError, match="isn't supported anymore"):
                validate_auth_selection_set(
                    harness_kind="claude",
                    sources=[
                        DesiredAuthSource(
                            source_kind="api_key",
                            api_key_id=None,
                            env_var_name="ANTHROPIC_API_KEY",
                            enabled=enabled,
                        )
                    ],
                )
        # Nameless vault-less api_key sources are the same retired shape.
        with pytest.raises(SelectionRuleError, match="isn't supported anymore"):
            validate_auth_selection_set(
                harness_kind="claude",
                sources=[
                    DesiredAuthSource(
                        source_kind="api_key",
                        api_key_id=None,
                        env_var_name=None,
                        enabled=True,
                    )
                ],
            )


class TestSeatSelectionRules:
    """Seats v1: the single-source radio counts KINDS, not seats.

    The pool selection shape (agent_auth spec §4 cell 1): one enabled seat
    row satisfies the radio however many seats the pool holds, and several
    enabled seat rows (the pool row plus pins) are still ONE selected method
    — while mixing a seat with any other kind, or stacking any non-seat
    kind, stays illegal.
    """

    def test_one_enabled_seat_row_is_legal_for_claude(self) -> None:
        validate_auth_selection_set(harness_kind="claude", sources=[_seat()])

    def test_pinned_seat_row_is_legal_too(self) -> None:
        validate_auth_selection_set(
            harness_kind="claude",
            sources=[_seat(api_key_id=uuid.uuid4())],
        )

    def test_multiple_enabled_seat_rows_count_as_one_kind(self) -> None:
        # The radio counts kinds: N seat rows are still the one "seat" method.
        validate_auth_selection_set(
            harness_kind="claude",
            sources=[
                _seat(),
                _seat(api_key_id=uuid.uuid4()),
                _seat(api_key_id=uuid.uuid4()),
            ],
        )

    def test_seat_plus_gateway_enabled_is_two_kinds_and_illegal(self) -> None:
        with pytest.raises(SelectionRuleError, match="at most one enabled auth method"):
            validate_auth_selection_set(
                harness_kind="claude",
                sources=[_seat(), _gateway()],
            )

    def test_seat_plus_api_key_enabled_is_two_kinds_and_illegal(self) -> None:
        with pytest.raises(SelectionRuleError, match="at most one enabled auth method"):
            validate_auth_selection_set(
                harness_kind="claude",
                sources=[_seat(), _api_key()],
            )

    def test_disabled_siblings_do_not_count(self) -> None:
        # Cardinality gates the ENABLED set only, unchanged for seats.
        validate_auth_selection_set(
            harness_kind="claude",
            sources=[_seat(), _gateway(enabled=False), _api_key(enabled=False)],
        )

    def test_two_enabled_api_key_rows_are_still_illegal_for_claude(self) -> None:
        # Kind-counting must NOT loosen the non-seat law: two rows of one
        # non-seat kind remain one-too-many for a radio harness.
        with pytest.raises(SelectionRuleError, match="at most one enabled auth source"):
            validate_auth_selection_set(
                harness_kind="claude",
                sources=[
                    _api_key(env_var_name="ANTHROPIC_API_KEY"),
                    _api_key(env_var_name="ANTHROPIC_AUTH_TOKEN"),
                ],
            )

    def test_seat_rejected_for_harness_without_a_seat_recipe(self) -> None:
        for harness in ("codex", "grok", "cursor", "opencode"):
            with pytest.raises(SelectionRuleError, match="no seat recipe"):
                validate_auth_selection_set(harness_kind=harness, sources=[_seat()])


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
