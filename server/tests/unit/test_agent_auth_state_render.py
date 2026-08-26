"""Renderer tests for the agent-auth state document (`agent_auth.state_render`).

The sandbox-push half of the original module left with the cloud sandbox stack.

Unit tests for cloud agent-auth state rendering (state.json v2)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from proliferate.db.store.agent_gateway import AgentAuthSelectionRecord
from proliferate.server.agent_auth import state_render as agent_auth

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_PATH = REPO_ROOT / "fixtures/contracts/agent-auth-state/v2.json"

USER_ID = uuid.uuid4()
NOW = datetime(2026, 7, 1, tzinfo=UTC)
REVISION = 4211

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_PATH = REPO_ROOT / "fixtures/contracts/agent-auth-state/v2.json"


def _selection(
    *,
    harness: str,
    source_kind: str = "gateway",
    surface: str = "cloud",
    api_key_id: uuid.UUID | None = None,
    env_var_name: str | None = None,
    enabled: bool = True,
) -> AgentAuthSelectionRecord:
    return AgentAuthSelectionRecord(
        id=uuid.uuid4(),
        user_id=USER_ID,
        harness_kind=harness,
        surface=surface,
        source_kind=source_kind,
        api_key_id=api_key_id,
        env_var_name=env_var_name,
        provider_hint=None,
        enabled=enabled,
        created_at=NOW,
        updated_at=NOW,
    )


def _inputs(
    selections: tuple[AgentAuthSelectionRecord, ...],
    *,
    revision: int = REVISION,
    api_key_values: dict[uuid.UUID, str] | None = None,
    provider_config_values: dict[uuid.UUID, tuple[str, dict[str, str]]] | None = None,
    enrollment_sync_status: str | None = "synced",
    gateway_virtual_key: str | None = "sk-litellm-vk",
    gateway_virtual_keys: dict[str, str] | None = None,
    gateway_base_url: str | None = "https://llm.proliferate.ai",
) -> agent_auth.AgentAuthStateInputs:
    """Build ``AgentAuthStateInputs``.

    ``gateway_virtual_key`` (singular) is the convenience default: every
    gateway-selection harness present in ``selections`` gets that same key
    value (or none, when ``None``) — the per-harness key map
    (model-gateway.md §Account model, R2) collapses to "one key" in tests
    that don't care about per-harness distinctness. Pass
    ``gateway_virtual_keys`` directly for tests that need distinct
    per-harness values.
    """
    if gateway_virtual_keys is None:
        gateway_virtual_keys = (
            {
                selection.harness_kind: gateway_virtual_key
                for selection in selections
                if selection.source_kind == "gateway"
            }
            if gateway_virtual_key is not None
            else {}
        )
    return agent_auth.AgentAuthStateInputs(
        user_id=USER_ID,
        revision=revision,
        selections=selections,
        api_key_values=api_key_values or {},
        provider_config_values=provider_config_values or {},
        enrollment_sync_status=enrollment_sync_status,
        gateway_virtual_keys=gateway_virtual_keys,
        gateway_base_url=gateway_base_url,
        harness_settings={},
    )


class TestRenderAgentAuthState:
    def test_gateway_and_api_key_source_shapes(self) -> None:
        key_id = uuid.uuid4()
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", source_kind="gateway"),
                    _selection(
                        harness="codex",
                        source_kind="api_key",
                        api_key_id=key_id,
                        env_var_name="OPENAI_API_KEY",
                    ),
                ),
                api_key_values={key_id: "sk-openai-raw"},
            )
        )
        assert state == {
            "version": 2,
            "revision": REVISION,
            "user_id": str(USER_ID),
            "harnesses": [
                {
                    "harness_kind": "claude",
                    "sources": [
                        {
                            "kind": "gateway",
                            "base_url": "https://llm.proliferate.ai",
                            "key": "sk-litellm-vk",
                        }
                    ],
                },
                {
                    "harness_kind": "codex",
                    "sources": [
                        {
                            "kind": "api_key",
                            "env_var_name": "OPENAI_API_KEY",
                            "value": "sk-openai-raw",
                        }
                    ],
                },
            ],
        }
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)

    def test_opencode_composes_gateway_plus_many_api_keys(self) -> None:
        anthropic_id = uuid.uuid4()
        xai_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="opencode", source_kind="gateway"),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=anthropic_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=xai_id,
                        env_var_name="XAI_API_KEY",
                    ),
                ),
                api_key_values={anthropic_id: "sk-ant-raw", xai_id: "xai-raw"},
            )
        )
        assert [entry["harness_kind"] for entry in state["harnesses"]] == ["opencode"]
        sources = state["harnesses"][0]["sources"]
        # Deterministic ordering: api_key rows (by env var) then gateway.
        assert sources == [
            {"kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "sk-ant-raw"},
            {"kind": "api_key", "env_var_name": "XAI_API_KEY", "value": "xai-raw"},
            {"kind": "gateway", "base_url": "https://llm.proliferate.ai", "key": "sk-litellm-vk"},
        ]

    def test_no_provider_hint_or_slot_on_the_wire(self) -> None:
        key_id = uuid.uuid4()
        selection = _selection(
            harness="claude",
            source_kind="api_key",
            api_key_id=key_id,
            env_var_name="ANTHROPIC_API_KEY",
        )
        selection = AgentAuthSelectionRecord(
            **{**selection.__dict__, "provider_hint": "anthropic"}
        )
        state, _ = agent_auth.render_agent_auth_state(
            _inputs((selection,), api_key_values={key_id: "sk-ant"})
        )
        serialized = json.dumps(state)
        assert "provider_hint" not in serialized
        assert "provider" not in serialized
        assert "slot" not in serialized
        assert "model_catalog" not in serialized

    def test_revoked_api_key_source_is_omitted(self) -> None:
        revoked_id = uuid.uuid4()
        live_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="claude",
                        source_kind="api_key",
                        api_key_id=revoked_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                    _selection(
                        harness="codex",
                        source_kind="api_key",
                        api_key_id=live_id,
                        env_var_name="OPENAI_API_KEY",
                    ),
                ),
                api_key_values={live_id: "sk-live"},
            )
        )
        # claude's only source was revoked -> the ENTRY STAYS, empty. Dropping it
        # would read as "never configured" at the runtime and silently launch on
        # the user's own login (agent-auth.md: present-but-empty fails closed).
        by_harness = {entry["harness_kind"]: entry["sources"] for entry in state["harnesses"]}
        assert sorted(by_harness) == ["claude", "codex"]
        assert by_harness["claude"] == []
        assert len(by_harness["codex"]) == 1

    def test_unsatisfiable_gateway_still_renders_satisfiable_api_key(self) -> None:
        live_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", source_kind="gateway"),
                    _selection(
                        harness="codex",
                        source_kind="api_key",
                        api_key_id=live_id,
                        env_var_name="OPENAI_API_KEY",
                    ),
                ),
                api_key_values={live_id: "sk-live"},
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        # codex keeps its live key; claude keeps its entry with no sources, so the
        # runtime refuses a claude launch rather than degrading it to native.
        by_harness = {entry["harness_kind"]: entry["sources"] for entry in state["harnesses"]}
        assert sorted(by_harness) == ["claude", "codex"]
        assert by_harness["claude"] == []
        assert len(by_harness["codex"]) == 1

    def test_all_unsatisfiable_keeps_the_selected_harness_with_no_sources(self) -> None:
        # The rewritten shape of the old `..._renders_empty_harnesses` test. An
        # exhausted/unsynced gateway must NOT produce an empty document: an empty
        # document is deleted by the materializer and reads as native, which is
        # exactly the silent degradation the fail-closed law forbids.
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="gateway"),),
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        assert state["harnesses"] == [{"harness_kind": "claude", "sources": []}]
        assert state["version"] == 2
        assert state["revision"] == REVISION

    def test_no_selections_at_all_renders_an_empty_document(self) -> None:
        # The one case that legitimately yields no harnesses — and therefore the
        # only case in which the materializer deletes the state file. This is what
        # keeps "absent means native" reachable at all.
        state, _ = agent_auth.render_agent_auth_state(_inputs(()))
        assert state["harnesses"] == []

    def test_gateway_without_public_base_url_logs_loud_warning(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # L7 (contract): a configured gateway selection dropped only because the
        # operator has not set the public base URL must warn loudly.
        warnings: list[str] = []

        def spy(msg: str, *args: object, **kwargs: object) -> None:
            warnings.append(msg % args if args else msg)

        monkeypatch.setattr(agent_auth.logger, "warning", spy)
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="gateway"),),
                gateway_base_url=None,
            )
        )
        assert state["harnesses"] == [{"harness_kind": "claude", "sources": []}]
        assert any(
            "gateway selection dropped" in message
            and "agent_gateway_litellm_public_base_url is not configured" in message
            for message in warnings
        )

    def test_gateway_with_unsynced_enrollment_drops_the_source_not_the_harness(self) -> None:
        for status in ("pending", "failed", None):
            state, _ = agent_auth.render_agent_auth_state(
                _inputs(
                    (_selection(harness="claude", source_kind="gateway"),),
                    enrollment_sync_status=status,
                    gateway_virtual_key=None,
                )
            )
            # The SOURCE is dropped; the harness entry survives empty so the
            # runtime refuses the launch instead of falling back to native.
            assert state["harnesses"] == [{"harness_kind": "claude", "sources": []}], status

    def test_each_gateway_harness_carries_its_own_key(self) -> None:
        """Two gateway harnesses render two DISTINCT keys (R2's whole point).

        The key map is per (subject, harness) so each harness is granted only
        its own access group. If the renderer collapsed the map to one value,
        every harness would ship a key scoped to some other harness's group —
        the pre-B2 one-shared-key behavior with none of the scoping.
        """
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", source_kind="gateway"),
                    _selection(harness="codex", source_kind="gateway"),
                ),
                gateway_virtual_keys={
                    "claude": "sk-litellm-claude",
                    "codex": "sk-litellm-codex",
                },
            )
        )
        rendered = {
            harness["harness_kind"]: [
                source["key"] for source in harness["sources"] if source["kind"] == "gateway"
            ]
            for harness in state["harnesses"]
        }
        assert rendered == {
            "claude": ["sk-litellm-claude"],
            "codex": ["sk-litellm-codex"],
        }

    def test_harness_missing_from_the_key_map_never_borrows_a_sibling_key(self) -> None:
        """Fails closed (``sources: []``, not dropped) and never borrows claude's key."""
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", source_kind="gateway"),
                    _selection(harness="codex", source_kind="gateway"),
                ),
                gateway_virtual_keys={"claude": "sk-litellm-claude"},
                gateway_base_url="https://llm",
            )
        )
        by_harness = {h["harness_kind"]: h["sources"] for h in state["harnesses"]}
        assert by_harness["claude"] == [
            {"kind": "gateway", "base_url": "https://llm", "key": "sk-litellm-claude"}
        ]
        assert by_harness["codex"] == []

    def test_fingerprint_is_stable_across_renders(self) -> None:
        selections = (_selection(harness="claude", source_kind="gateway"),)
        first = agent_auth.render_agent_auth_state(_inputs(selections))
        second = agent_auth.render_agent_auth_state(_inputs(selections))
        assert first == second
        assert first[1]

    def test_fingerprint_changes_when_virtual_key_rotates(self) -> None:
        selections = (_selection(harness="claude", source_kind="gateway"),)
        _, before = agent_auth.render_agent_auth_state(_inputs(selections))
        _, after = agent_auth.render_agent_auth_state(
            _inputs(selections, gateway_virtual_key="sk-litellm-rotated")
        )
        assert before != after

    def test_ordering_is_independent_of_input_order(self) -> None:
        key_id = uuid.uuid4()
        forward = (
            _selection(harness="claude", source_kind="gateway"),
            _selection(harness="codex", source_kind="gateway"),
        )
        reverse = tuple(reversed(forward))
        first, fp1 = agent_auth.render_agent_auth_state(_inputs(forward))
        second, fp2 = agent_auth.render_agent_auth_state(_inputs(reverse))
        assert [h["harness_kind"] for h in first["harnesses"]] == ["claude", "codex"]
        assert first == second
        assert fp1 == fp2
        _ = key_id


class TestTranslateProviderConfigEnv:
    """D3 brief §4.2's ruled table, one case per row (6 combinations)."""

    def test_claude_aws_bedrock(self) -> None:
        env = agent_auth._translate_provider_config_env(
            "claude", "aws_bedrock", {"region": "us-east-1", "bearerToken": "bedrock-tok"}
        )
        assert env == {
            "CLAUDE_CODE_USE_BEDROCK": "1",
            "AWS_BEARER_TOKEN_BEDROCK": "bedrock-tok",
            "AWS_REGION": "us-east-1",
        }

    def test_claude_azure_openai_foundry(self) -> None:
        # UNVERIFIED judgment call (brief §0/§4.2/§8 item 4): resource derived
        # from endpoint hostname, AUTH_TOKEN left unset. Gate 4's live run is
        # authoritative; this pins today's ruled mapping only.
        env = agent_auth._translate_provider_config_env(
            "claude",
            "azure_openai",
            {
                "endpoint": "https://my-foundry-resource.openai.azure.com",
                "deployment": "claude-deploy",
                "apiKey": "foundry-key-abcd",
            },
        )
        assert env == {
            "CLAUDE_CODE_USE_FOUNDRY": "1",
            "ANTHROPIC_FOUNDRY_RESOURCE": "my-foundry-resource",
            "ANTHROPIC_FOUNDRY_BASE_URL": "https://my-foundry-resource.openai.azure.com",
            "ANTHROPIC_FOUNDRY_API_KEY": "foundry-key-abcd",
        }
        assert "ANTHROPIC_FOUNDRY_AUTH_TOKEN" not in env

    def test_codex_aws_bedrock(self) -> None:
        env = agent_auth._translate_provider_config_env(
            "codex", "aws_bedrock", {"region": "us-west-2", "bearerToken": "bedrock-tok"}
        )
        assert env == {"AWS_BEARER_TOKEN_BEDROCK": "bedrock-tok", "AWS_REGION": "us-west-2"}

    def test_codex_azure_openai_is_always_none(self) -> None:
        # Pending per registry.json + D1's supported_provider_config_kinds
        # exclusion (D3 brief §4.2 table row: "None always"). Defended here
        # too rather than trusting the upstream gate alone.
        env = agent_auth._translate_provider_config_env(
            "codex",
            "azure_openai",
            {"endpoint": "https://x.openai.azure.com", "deployment": "d", "apiKey": "k"},
        )
        assert env is None

    def test_opencode_aws_bedrock(self) -> None:
        env = agent_auth._translate_provider_config_env(
            "opencode", "aws_bedrock", {"region": "eu-west-1", "bearerToken": "bedrock-tok"}
        )
        assert env == {"AWS_BEARER_TOKEN_BEDROCK": "bedrock-tok", "AWS_REGION": "eu-west-1"}

    def test_opencode_azure_openai_live_proven_pair(self) -> None:
        # Live-test-proven (ledger 2026-07-26): AZURE_API_KEY + AZURE_RESOURCE_NAME
        # is the working pair; AZURE_OPENAI_API_KEY is dead code. `deployment`
        # is deliberately absent from the output (folds into a launch arg,
        # brief §4.2/§8 item 3 — out of scope for this env-only translation).
        env = agent_auth._translate_provider_config_env(
            "opencode",
            "azure_openai",
            {
                "endpoint": "https://proliferate-gw-aoai.openai.azure.com",
                "deployment": "gpt-4o",
                "apiKey": "azure-raw-key",
            },
        )
        assert env == {
            "AZURE_API_KEY": "azure-raw-key",
            "AZURE_RESOURCE_NAME": "proliferate-gw-aoai",
        }

    def test_opencode_azure_hostname_derivation_edge_cases(self) -> None:
        # The live-test evidence only confirms a bare resource name works;
        # this asserts a full URL with a trailing slash/path also extracts
        # cleanly (brief §6's explicitly-named edge case).
        bare = agent_auth._translate_provider_config_env(
            "opencode",
            "azure_openai",
            {"endpoint": "proliferate-gw-aoai", "deployment": "d", "apiKey": "k"},
        )
        assert bare is not None
        assert bare["AZURE_RESOURCE_NAME"] == "proliferate-gw-aoai"

        trailing_slash = agent_auth._translate_provider_config_env(
            "opencode",
            "azure_openai",
            {"endpoint": "https://foo.openai.azure.com/", "deployment": "d", "apiKey": "k"},
        )
        assert trailing_slash is not None
        assert trailing_slash["AZURE_RESOURCE_NAME"] == "foo"

        with_path = agent_auth._translate_provider_config_env(
            "opencode",
            "azure_openai",
            {
                "endpoint": "https://foo.openai.azure.com/openai/deployments/x",
                "deployment": "d",
                "apiKey": "k",
            },
        )
        assert with_path is not None
        assert with_path["AZURE_RESOURCE_NAME"] == "foo"

        # Not evidenced by the live run and not an expected D2 vault shape,
        # but the function's contract is "first label of the hostname" — it
        # must strip userinfo and a port rather than fold them into the
        # returned resource name (review finding 5).
        with_userinfo_and_port = agent_auth._translate_provider_config_env(
            "opencode",
            "azure_openai",
            {
                "endpoint": "https://user@foo.openai.azure.com:8443/path",
                "deployment": "d",
                "apiKey": "k",
            },
        )
        assert with_userinfo_and_port is not None
        assert with_userinfo_and_port["AZURE_RESOURCE_NAME"] == "foo"

    def test_unsupported_harness_returns_none(self) -> None:
        assert (
            agent_auth._translate_provider_config_env(
                "cursor", "aws_bedrock", {"region": "us-east-1", "bearerToken": "t"}
            )
            is None
        )

    def test_unknown_config_kind_returns_none(self) -> None:
        assert agent_auth._translate_provider_config_env("claude", "not_a_real_kind", {}) is None

    def test_missing_required_field_returns_none(self) -> None:
        assert (
            agent_auth._translate_provider_config_env("claude", "aws_bedrock", {"region": "x"})
            is None
        )


class TestRenderProviderConfigSource:
    def test_renders_resolved_env_map_on_the_wire(self) -> None:
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
                    key_id: ("aws_bedrock", {"region": "us-east-1", "bearerToken": "tok"})
                },
            )
        )
        assert state["harnesses"] == [
            {
                "harness_kind": "codex",
                "sources": [
                    {
                        "kind": "provider_config",
                        "config_kind": "aws_bedrock",
                        "env": {"AWS_BEARER_TOKEN_BEDROCK": "tok", "AWS_REGION": "us-east-1"},
                    }
                ],
            }
        ]

    def test_revoked_typed_entry_drops_the_source(self) -> None:
        # Mirrors _render_api_key_source's revoked-key test: a typed entry
        # that no longer resolves (revoked/vanished) is simply absent from
        # provider_config_values, and its source is dropped rather than
        # raising -- one unsatisfiable source never aborts the reconcile.
        # Under A4's fail-closed rendering the selected harness keeps its
        # entry with an empty sources list (same law as the fixture's grok),
        # rather than vanishing from the document.
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
        assert state["harnesses"] == [{"harness_kind": "codex", "sources": []}]

    def test_unsupported_combination_drops_the_source(self) -> None:
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
        # A4 fail-closed: entry retained, sources empty.
        assert state["harnesses"] == [{"harness_kind": "codex", "sources": []}]

    def test_composes_with_gateway_and_bare_api_key_sources(self) -> None:
        # The opencode three-way composition the contract fixture (§4.3)
        # also pins: api_key < gateway < provider_config by the (kind,
        # env_var_name) sort.
        anthropic_id = uuid.uuid4()
        bedrock_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="opencode", source_kind="gateway"),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=anthropic_id,
                        env_var_name="ANTHROPIC_API_KEY",
                    ),
                    _selection(
                        harness="opencode",
                        source_kind="api_key",
                        api_key_id=bedrock_id,
                    ),
                ),
                api_key_values={anthropic_id: "sk-ant-raw"},
                provider_config_values={
                    bedrock_id: ("aws_bedrock", {"region": "us-east-1", "bearerToken": "tok"})
                },
            )
        )
        assert [entry["harness_kind"] for entry in state["harnesses"]] == ["opencode"]
        kinds = [source["kind"] for source in state["harnesses"][0]["sources"]]
        assert kinds == ["api_key", "gateway", "provider_config"]
