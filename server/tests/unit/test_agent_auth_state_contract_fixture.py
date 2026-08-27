"""Producer half of ``fixtures/contracts/agent-auth-state/v2.json``.

Python produces the document, Rust consumes it
(``route_auth/contract_fixture_tests.rs``). Per
``specs/engineering/testing/standard.md``, the fixture is the shape's single
definition: change it and whichever side lags breaks mechanically.

Split out of ``test_agent_auth_materialization.py`` (which sat at its line-count
ceiling) and sharing that module's ``_inputs``/``_selection`` builders so the
producer under test is configured exactly as the renderer suite configures it.
"""

from __future__ import annotations

import json
import uuid

from proliferate.server.agent_auth import state_render as agent_auth
from tests.unit.test_agent_auth_state_render import (
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
            assert set(entry) <= {"harness_kind", "sources", "settings", "unsatisfied_reason"}
            for source in entry["sources"]:
                assert source["kind"] in ("gateway", "api_key", "provider_config", "seat")
                if source["kind"] == "gateway":
                    assert set(source) == {"kind", "base_url", "key"}
                elif source["kind"] == "api_key":
                    assert set(source) == {"kind", "env_var_name", "value"}
                elif source["kind"] == "seat":
                    assert set(source) == {"kind", "env", "seat_id"}
                    # The env map is ALREADY the harness's real env-var name —
                    # exactly one, the seat token (agent_auth spec §2's wire
                    # table); seat_id is the vault entry id, never the token.
                    assert set(source["env"]) == {"CLAUDE_CODE_OAUTH_TOKEN"}
                    assert isinstance(source["seat_id"], str) and source["seat_id"]
                else:
                    assert set(source) == {"kind", "config_kind", "env"}
                    assert isinstance(source["env"], dict)
                    assert source["env"], "a provider_config source must carry a non-empty env map"
                    assert all(isinstance(v, str) for v in source["env"].values())

    def test_this_renderer_produces_the_fixtures_empty_sources_semantics(self) -> None:
        # The half of the contract this renderer owns TODAY: a selected harness
        # whose sources are all unsatisfiable keeps its entry with an empty list
        # AND names the actual why (the fixture's `grok`), while a harness with
        # no selection row is absent (the fixture has no `opencode-zen`).
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture_kinds = {entry["harness_kind"] for entry in fixture["harnesses"]}
        assert "grok" in fixture_kinds
        assert "opencode-zen" not in fixture_kinds
        fixture_grok = next(
            entry for entry in fixture["harnesses"] if entry["harness_kind"] == "grok"
        )

        # The fixture's grok scenario: a gateway selection on an account whose
        # enrollment is still pending and holds no minted key.
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="grok", source_kind="gateway"),),
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        rendered = {entry["harness_kind"]: entry for entry in state["harnesses"]}
        assert rendered == {"grok": fixture_grok}, (
            "a selected-but-unsatisfiable harness must keep an empty entry naming "
            "the actual why, exactly as the fixture's grok does"
        )
        assert fixture_grok["unsatisfied_reason"] == (
            "managed model access isn't ready on this account yet"
        )

    def test_the_fixtures_source_order_is_the_order_this_renderer_emits(self) -> None:
        # A fixture the producer could never emit is worse than no fixture: the
        # consumer would pin a document shape that never reaches a sandbox. This
        # renderer sorts a harness's sources by (kind, env_var_name), and
        # "api_key" < "gateway" < "provider_config" -- so opencode's three
        # sources appear in exactly that order. Feed the renderer the fixture's
        # own opencode inputs and compare kind-for-kind.
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture_opencode = next(
            entry for entry in fixture["harnesses"] if entry["harness_kind"] == "opencode"
        )
        anthropic_id = uuid.uuid4()
        bedrock_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    # Deliberately fed out of order, so the assertion is about
                    # the renderer's sort rather than about input order.
                    _selection(harness="opencode", source_kind="gateway"),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=bedrock_id,
                    ),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=anthropic_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                ),
                api_key_values={anthropic_id: "sk-ant-raw"},
                provider_config_values={
                    bedrock_id: (
                        "aws_bedrock",
                        {"region": "us-east-1", "bearerToken": "bedrock-tok"},
                    )
                },
            )
        )
        rendered_opencode = next(
            entry for entry in state["harnesses"] if entry["harness_kind"] == "opencode"
        )
        assert [source["kind"] for source in rendered_opencode["sources"]] == [
            source["kind"] for source in fixture_opencode["sources"]
        ], (
            "the fixture's per-harness source order must be the order this renderer "
            "emits -- api_key, then gateway, then provider_config, by the "
            "(kind, env_var_name) sort"
        )
        assert [source["kind"] for source in fixture_opencode["sources"]] == [
            "api_key",
            "gateway",
            "provider_config",
        ]

    def test_each_gateway_harness_renders_its_own_distinct_key(self) -> None:
        # B3's per-harness key map is on this branch, so the pre-B3 lineage's
        # shared-key tripwire test is deleted (its own comment demanded that
        # once B3 landed). The fixture's claude/codex/opencode gateway keys
        # are all distinct; assert this renderer reproduces that when fed the
        # fixture's own per-harness inputs.
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture_keys = {
            entry["harness_kind"]: next(
                source["key"] for source in entry["sources"] if source["kind"] == "gateway"
            )
            for entry in fixture["harnesses"]
            if any(source["kind"] == "gateway" for source in entry["sources"])
        }
        assert len(set(fixture_keys.values())) == len(fixture_keys), (
            "the fixture's own gateway keys must already be distinct per harness"
        )

        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                tuple(
                    _selection(harness=harness_kind, source_kind="gateway")
                    for harness_kind in fixture_keys
                ),
                gateway_virtual_keys=fixture_keys,
            )
        )
        rendered_keys = {
            entry["harness_kind"]: next(
                source["key"] for source in entry["sources"] if source["kind"] == "gateway"
            )
            for entry in state["harnesses"]
        }
        assert rendered_keys == fixture_keys

    def test_the_fixtures_seat_source_is_what_this_renderer_emits(self) -> None:
        # Seats (slice 2): claude's fixture entry is the three-seat POOL — the
        # shape a pool seat selection expands to when the vault holds several
        # active seats, in vault order (rotation's raw material: the runtime
        # picks the serving seat, the server supplies the pool). Feed the
        # renderer the fixture's own seats in vault order and require a
        # byte-identical claude entry.
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture_claude = next(
            entry for entry in fixture["harnesses"] if entry["harness_kind"] == "claude"
        )
        assert [source["kind"] for source in fixture_claude["sources"]] == [
            "seat",
            "seat",
            "seat",
        ]

        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="seat"),),
                seat_values=tuple(
                    (
                        uuid.UUID(source["seat_id"]),
                        source["env"]["CLAUDE_CODE_OAUTH_TOKEN"],
                    )
                    for source in fixture_claude["sources"]
                ),
            )
        )
        rendered_claude = next(
            entry for entry in state["harnesses"] if entry["harness_kind"] == "claude"
        )
        assert rendered_claude == fixture_claude

    def test_the_fixtures_provider_config_source_is_a_resolved_env_map(self) -> None:
        # §4.3's ruling: opencode's third source demonstrates additive
        # three-way composition. Its env map must already be opencode's real
        # env-var names (AWS_BEARER_TOKEN_BEDROCK/AWS_REGION), not the vault's
        # generic field names (region/bearerToken) -- feeding the fixture's
        # own config_kind + a matching field map through the translation
        # table must reproduce it exactly.
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture_opencode = next(
            entry for entry in fixture["harnesses"] if entry["harness_kind"] == "opencode"
        )
        fixture_provider_config = next(
            source for source in fixture_opencode["sources"] if source["kind"] == "provider_config"
        )
        assert fixture_provider_config["config_kind"] == "aws_bedrock"

        translated = agent_auth._translate_provider_config_env(
            "opencode",
            "aws_bedrock",
            {"region": "us-east-1", "bearerToken": "bedrock-raw-0006"},
        )
        assert translated == fixture_provider_config["env"]
