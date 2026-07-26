"""Producer half of ``fixtures/contracts/agent-auth-state/v2.json``.

Python produces the document, Rust consumes it
(``route_auth/contract_fixture_tests.rs``). Per
``specs/developing/testing/README.md``, the fixture is the shape's single
definition: change it and whichever side lags breaks mechanically.

Split out of ``test_agent_auth_materialization.py`` (which sat at its line-count
ceiling) and sharing that module's ``_inputs``/``_selection`` builders so the
producer under test is configured exactly as the renderer suite configures it.
"""

from __future__ import annotations

import json
import uuid

from proliferate.server.cloud.materialization.materialize import agent_auth
from tests.unit.test_agent_auth_materialization import (
    FIXTURE_PATH,
    _inputs,
    _selection,
)


class TestAgentAuthStateContractFixture:
    def test_the_fixture_is_a_valid_v2_document_this_renderer_could_emit(self) -> None:
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        assert fixture["version"] == agent_auth.AGENT_AUTH_STATE_VERSION
        assert isinstance(fixture["revision"], int)
        # snake_case on the wire, and no UI-only fields leak into it.
        serialized = json.dumps(fixture)
        for forbidden in ("provider_hint", "harnessKind", "envVarName", "model_catalog"):
            assert forbidden not in serialized, forbidden
        for entry in fixture["harnesses"]:
            assert set(entry) <= {"harness_kind", "sources", "settings"}
            for source in entry["sources"]:
                assert source["kind"] in ("gateway", "api_key")
                if source["kind"] == "gateway":
                    assert set(source) == {"kind", "base_url", "key"}
                else:
                    assert set(source) == {"kind", "env_var_name", "value"}

    def test_this_renderer_produces_the_fixtures_empty_sources_semantics(self) -> None:
        # The half of the contract this renderer owns TODAY: a selected harness
        # whose sources are all unsatisfiable keeps its entry with an empty list
        # (the fixture's `grok`), while a harness with no selection row is absent
        # (the fixture has no `opencode-zen`).
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture_kinds = {entry["harness_kind"] for entry in fixture["harnesses"]}
        assert "grok" in fixture_kinds
        assert "opencode-zen" not in fixture_kinds

        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="grok", source_kind="gateway"),),
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        rendered = {entry["harness_kind"]: entry["sources"] for entry in state["harnesses"]}
        assert rendered == {"grok": []}, (
            "a selected-but-unsatisfiable harness must keep an empty entry, exactly "
            "as the fixture's grok does"
        )

    def test_the_fixtures_source_order_is_the_order_this_renderer_emits(self) -> None:
        # A fixture the producer could never emit is worse than no fixture: the
        # consumer would pin a document shape that never reaches a sandbox. This
        # renderer sorts a harness's sources by (kind, env_var_name), and
        # "api_key" < "gateway" — so opencode's api_key row comes FIRST. Feed the
        # renderer the fixture's own opencode inputs and compare kind-for-kind.
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture_opencode = next(
            entry for entry in fixture["harnesses"] if entry["harness_kind"] == "opencode"
        )
        anthropic_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    # Deliberately fed gateway-first, so the assertion is about the
                    # renderer's sort rather than about input order.
                    _selection(harness="opencode", source_kind="gateway"),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=anthropic_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                ),
                api_key_values={anthropic_id: "sk-ant-raw"},
            )
        )
        rendered_opencode = next(
            entry for entry in state["harnesses"] if entry["harness_kind"] == "opencode"
        )
        assert [source["kind"] for source in rendered_opencode["sources"]] == [
            source["kind"] for source in fixture_opencode["sources"]
        ], (
            "the fixture's per-harness source order must be the order this renderer "
            "emits — api_key before gateway, by the (kind, env_var_name) sort"
        )
        assert [source["kind"] for source in fixture_opencode["sources"]] == [
            "api_key",
            "gateway",
        ]

    def test_per_harness_gateway_keys_are_not_produced_yet(self) -> None:
        # KNOWN GAP, owned by Track B (B3, branch `agents/b3-renderer-key-map`).
        # The fixture gives every gateway source its own virtual key because the
        # gateway scopes keys per (subject, harness); this renderer still resolves
        # ONE subject-wide `gateway_virtual_key` and fans it out. That is the "one
        # shared gateway key" bullet in agent-auth.md's Current gaps, and it is NOT
        # closed here.
        #
        # This test asserts the gap as it stands so B3 has to delete it when it
        # lands the per-harness key map — a passing suite after B3 would otherwise
        # hide that the fixture and the producer disagree.
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", source_kind="gateway"),
                    _selection(harness="codex", source_kind="gateway"),
                )
            )
        )
        keys = [
            source["key"]
            for entry in state["harnesses"]
            for source in entry["sources"]
            if source["kind"] == "gateway"
        ]
        assert len(keys) == 2
        assert len(set(keys)) == 1, (
            "expected today's shared-key behavior; if this now fails, B3 has landed "
            "per-harness keys — delete this test and assert distinctness instead"
        )
