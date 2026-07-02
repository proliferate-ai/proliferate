"""Unit tests for target-scoped agent-auth rendering (inheritance, design §3.1)."""

from __future__ import annotations

import uuid

from proliferate.server.cloud.materialization.materialize import agent_auth
from tests.unit.test_agent_auth_materialization import _inputs, _selection


class TestRenderTargetScope:
    """Inheritance render for target-scoped documents (design §3.1)."""

    def test_zero_overrides_is_byte_identical_to_default_document(self) -> None:
        target_id = uuid.uuid4()
        selections = (
            _selection(harness="claude", surface="local", route="native", revision=3),
            _selection(harness="grok", surface="local", route="gateway", revision=1),
        )
        default_doc = agent_auth.render_agent_auth_state(_inputs(selections), surface="local")
        target_doc = agent_auth.render_agent_auth_state(
            _inputs(selections, target_id=target_id),
            surface="local",
        )
        assert target_doc == default_doc

    def test_override_wins_per_slot_and_untouched_harness_inherits(self) -> None:
        target_id = uuid.uuid4()
        key_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", surface="local", route="native", revision=2),
                    _selection(harness="codex", surface="local", route="native", revision=1),
                    _selection(
                        harness="claude",
                        surface="local",
                        route="api_key",
                        api_key_id=key_id,
                        target_id=target_id,
                    ),
                ),
                api_key_secrets={key_id: ("anthropic", "sk-ant-raw")},
                target_id=target_id,
            ),
            surface="local",
        )
        assert state is not None
        assert state["selections"] == [
            {
                "harness": "claude",
                "route": "api_key",
                "slot": "primary",
                "provider": "anthropic",
                "key": "sk-ant-raw",
            },
            {"harness": "codex", "route": "native", "slot": "primary"},
        ]

    def test_target_rows_never_leak_into_default_document(self) -> None:
        target_id = uuid.uuid4()
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="claude",
                        surface="local",
                        route="native",
                        target_id=target_id,
                    ),
                ),
            ),
            surface="local",
        )
        assert state is None
        assert fingerprint == ""

    def test_foreign_target_rows_do_not_apply(self) -> None:
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", surface="local", route="native", revision=2),
                    _selection(
                        harness="claude",
                        surface="local",
                        route="gateway",
                        target_id=uuid.uuid4(),
                        revision=9,
                    ),
                ),
                target_id=uuid.uuid4(),
            ),
            surface="local",
        )
        assert state is not None
        assert state["revision"] == 2
        assert state["selections"] == [
            {"harness": "claude", "route": "native", "slot": "primary"},
        ]

    def test_revision_is_max_over_default_and_override_union(self) -> None:
        target_id = uuid.uuid4()
        selections = (
            _selection(harness="claude", surface="local", route="native", revision=3),
            _selection(
                harness="claude",
                surface="local",
                route="native",
                target_id=target_id,
                revision=1,
            ),
        )
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(selections, target_id=target_id),
            surface="local",
        )
        assert state is not None
        # A fresh override (revision 1) must not undercut the already-pushed
        # default document's revision (3): max is over the union of layers.
        assert state["revision"] == 3

    def test_target_only_rows_render_without_defaults(self) -> None:
        target_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="claude",
                        surface="local",
                        route="native",
                        target_id=target_id,
                        revision=2,
                    ),
                ),
                target_id=target_id,
            ),
            surface="local",
        )
        assert state is not None
        assert state["revision"] == 2
        assert state["selections"] == [
            {"harness": "claude", "route": "native", "slot": "primary"},
        ]
