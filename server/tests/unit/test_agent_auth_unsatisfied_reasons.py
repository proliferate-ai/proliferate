"""Renderer refusal vocabulary (`agent_auth.state_render`, slice 2).

A present-but-empty harness entry names its actual why in plain words —
`unsatisfied_reason`, one frozen string per cause family, attached only when
every source dropped (first-drop-wins) and NEVER beside a rendered source.
The strings are asserted literally: they are the wire contract (the contract
fixture pins grok's), not internal constants a rename may chase.

Lives in its own module rather than `test_agent_auth_state_render.py`, which
sits at its recorded line-count ratchet; shares that module's `_inputs` /
`_selection` builders so the renderer is configured exactly as the main suite
configures it.
"""

from __future__ import annotations

import dataclasses
import uuid

from proliferate.server.agent_auth import state_render as agent_auth
from tests.unit.test_agent_auth_state_render import _inputs, _selection

GATEWAY_NOT_READY = "managed model access isn't ready on this account yet"
GATEWAY_BUDGET = "the team is out of LLM credits"
KEY_REVOKED = "its API key was revoked or removed"
SEATS_GONE = "its Claude.ai login was removed or signed out"
UNSUPPORTED = "this provider configuration isn't supported for this agent"


def _entry(state: dict[str, object], harness: str) -> dict[str, object]:
    harnesses = state["harnesses"]
    assert isinstance(harnesses, list)
    return next(entry for entry in harnesses if entry["harness_kind"] == harness)


class TestUnsatisfiedReasonVocabulary:
    """One case per frozen vocabulary row."""

    def test_gateway_not_ready_names_account_readiness(self) -> None:
        # Enrollment pending, no minted key: the account-readiness family.
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="gateway"),),
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        assert _entry(state, "claude") == {
            "harness_kind": "claude",
            "sources": [],
            "unsatisfied_reason": GATEWAY_NOT_READY,
        }

    def test_gateway_without_public_base_url_is_also_not_ready(self) -> None:
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="gateway"),),
                gateway_base_url=None,
            )
        )
        assert _entry(state, "claude")["unsatisfied_reason"] == GATEWAY_NOT_READY

    def test_gateway_budget_withheld_names_the_credits(self) -> None:
        # A synced enrollment whose keys were withheld because the budget
        # predicate said no: the renderer knows (gateway_budget_available is
        # False from the load pass) and must NOT call it account-readiness.
        state, _ = agent_auth.render_agent_auth_state(
            dataclasses.replace(
                _inputs(
                    (_selection(harness="claude", source_kind="gateway"),),
                    enrollment_sync_status="synced",
                    gateway_virtual_key=None,
                ),
                gateway_budget_available=False,
            )
        )
        assert _entry(state, "claude") == {
            "harness_kind": "claude",
            "sources": [],
            "unsatisfied_reason": GATEWAY_BUDGET,
        }

    def test_budget_never_consulted_stays_not_ready(self) -> None:
        # gateway_budget_available=None (the load pass never consulted the
        # predicate — e.g. unsynced enrollment) must not claim "out of
        # credits": only a False verdict earns the budget words.
        state, _ = agent_auth.render_agent_auth_state(
            dataclasses.replace(
                _inputs(
                    (_selection(harness="claude", source_kind="gateway"),),
                    enrollment_sync_status="synced",
                    gateway_virtual_key=None,
                ),
                gateway_budget_available=None,
            )
        )
        assert _entry(state, "claude")["unsatisfied_reason"] == GATEWAY_NOT_READY

    def test_revoked_bare_api_key_names_the_key(self) -> None:
        key_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="claude",
                        source_kind="api_key",
                        api_key_id=key_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                ),
                api_key_values={},
            )
        )
        assert _entry(state, "claude") == {
            "harness_kind": "claude",
            "sources": [],
            "unsatisfied_reason": KEY_REVOKED,
        }

    def test_revoked_typed_provider_config_names_the_key_too(self) -> None:
        # A typed vault entry that vanished resolves into NEITHER value map;
        # the same plain words apply (the user revoked or removed the entry).
        key_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="codex",
                        source_kind="api_key",
                        api_key_id=key_id,
                    ),
                ),
                provider_config_values={},
            )
        )
        assert _entry(state, "codex")["unsatisfied_reason"] == KEY_REVOKED

    def test_vanished_seat_pool_names_the_login(self) -> None:
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="seat"),),
                seat_values=(),
            )
        )
        assert _entry(state, "claude") == {
            "harness_kind": "claude",
            "sources": [],
            "unsatisfied_reason": SEATS_GONE,
        }

    def test_vanished_pinned_seat_names_the_login(self) -> None:
        pinned = uuid.uuid4()
        other = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="seat", api_key_id=pinned),),
                seat_values=((other, "sk-tok-other"),),
            )
        )
        assert _entry(state, "claude")["unsatisfied_reason"] == SEATS_GONE

    def test_unsupported_provider_config_combination_names_the_agent(self) -> None:
        # codex×azure_openai is a pending combination the translation table
        # refuses (registry-excluded; defended at render too).
        key_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="codex",
                        source_kind="api_key",
                        api_key_id=key_id,
                    ),
                ),
                provider_config_values={
                    key_id: (
                        "azure_openai",
                        {"endpoint": "https://x.openai.azure.com", "apiKey": "k"},
                    )
                },
            )
        )
        assert _entry(state, "codex") == {
            "harness_kind": "codex",
            "sources": [],
            "unsatisfied_reason": UNSUPPORTED,
        }


class TestUnsatisfiedReasonAttachment:
    """The attachment law: only present-but-empty entries carry a reason."""

    def test_reason_never_attached_when_any_source_renders(self) -> None:
        # One revoked key beside one satisfiable gateway: the entry keeps its
        # rendered source and must NOT carry a reason for the dropped one.
        revoked_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="opencode", source_kind="gateway"),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=revoked_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                ),
                api_key_values={},
            )
        )
        entry = _entry(state, "opencode")
        assert entry["sources"], "the gateway source must have rendered"
        assert "unsatisfied_reason" not in entry

    def test_fully_satisfied_harness_carries_no_reason_key(self) -> None:
        state, _ = agent_auth.render_agent_auth_state(
            _inputs((_selection(harness="claude", source_kind="gateway"),))
        )
        assert "unsatisfied_reason" not in _entry(state, "claude")

    def test_first_drop_wins_when_several_sources_dropped(self) -> None:
        # A revoked key drops first (input order), then the gateway drops for
        # account-readiness: the entry names the FIRST cause.
        revoked_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=revoked_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                    _selection(harness="opencode", source_kind="gateway"),
                ),
                api_key_values={},
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        assert _entry(state, "opencode") == {
            "harness_kind": "opencode",
            "sources": [],
            "unsatisfied_reason": KEY_REVOKED,
        }

    def test_a_dropped_pin_beside_a_rendered_pool_attaches_nothing(self) -> None:
        # The pool row renders a seat; a pin whose seat vanished drops. The
        # entry has sources, so no reason may ride.
        pool_seat = uuid.uuid4()
        vanished = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", source_kind="seat"),
                    _selection(harness="claude", source_kind="seat", api_key_id=vanished),
                ),
                seat_values=((pool_seat, "sk-tok-pool"),),
            )
        )
        entry = _entry(state, "claude")
        assert [source["seat_id"] for source in entry["sources"]] == [str(pool_seat)]
        assert "unsatisfied_reason" not in entry
