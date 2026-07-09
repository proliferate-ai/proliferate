"""Unit tests for cloud agent-auth state rendering (state.json v2)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.db.store.agent_gateway import AgentAuthSelectionRecord
from proliferate.server.cloud.materialization import paths
from proliferate.server.cloud.materialization.materialize import agent_auth

USER_ID = uuid.uuid4()
NOW = datetime(2026, 7, 1, tzinfo=UTC)
REVISION = 4211


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
    enrollment_sync_status: str | None = "synced",
    gateway_virtual_key: str | None = "sk-litellm-vk",
    gateway_base_url: str | None = "https://llm.proliferate.ai",
) -> agent_auth.AgentAuthStateInputs:
    return agent_auth.AgentAuthStateInputs(
        user_id=USER_ID,
        revision=revision,
        selections=selections,
        api_key_values=api_key_values or {},
        enrollment_sync_status=enrollment_sync_status,
        gateway_virtual_key=gateway_virtual_key,
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
        # claude's only source was revoked -> the harness disappears entirely.
        assert [entry["harness_kind"] for entry in state["harnesses"]] == ["codex"]

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
        assert [entry["harness_kind"] for entry in state["harnesses"]] == ["codex"]

    def test_all_unsatisfiable_renders_empty_harnesses(self) -> None:
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", source_kind="gateway"),),
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        assert state["harnesses"] == []
        assert state["version"] == 2
        assert state["revision"] == REVISION

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
        assert state["harnesses"] == []
        assert any(
            "gateway selection dropped" in message
            and "agent_gateway_litellm_public_base_url is not configured" in message
            for message in warnings
        )

    def test_gateway_with_unsynced_enrollment_is_dropped(self) -> None:
        for status in ("pending", "failed", None):
            state, _ = agent_auth.render_agent_auth_state(
                _inputs(
                    (_selection(harness="claude", source_kind="gateway"),),
                    enrollment_sync_status=status,
                    gateway_virtual_key=None,
                )
            )
            assert state["harnesses"] == []

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


class _SandboxIOSpy:
    def __init__(self, previous_manifest: dict[str, object] | None) -> None:
        self.previous_manifest = previous_manifest
        self.writes: list[dict[str, Any]] = []
        self.removed: set[str] = set()
        self.read_count = 0

    async def write_private_file_atomic(
        self,
        target: object,
        *,
        operation_id: uuid.UUID,
        path: str,
        content: str | bytes,
        mode: str = "600",
        allowed_root: str | None = None,
    ) -> None:
        self.writes.append({"path": path, "content": content, "mode": mode})

    async def remove_owned_files(
        self,
        target: object,
        *,
        operation_id: uuid.UUID,
        paths: set[str],
        allowed_root: str | None = None,
    ) -> None:
        self.removed |= paths

    async def run_materialization_script(
        self,
        target: object,
        *,
        operation_id: uuid.UUID,
        label: str,
        script: str,
        timeout_seconds: int = 60,
        **kwargs: Any,
    ) -> str:
        self.read_count += 1
        if self.previous_manifest is None:
            return ""
        return json.dumps(self.previous_manifest)


def _install_spy(
    monkeypatch: pytest.MonkeyPatch,
    *,
    previous_manifest: dict[str, object] | None,
) -> _SandboxIOSpy:
    spy = _SandboxIOSpy(previous_manifest)
    monkeypatch.setattr(
        agent_auth.sandbox_io, "write_private_file_atomic", spy.write_private_file_atomic
    )
    monkeypatch.setattr(agent_auth.sandbox_io, "remove_owned_files", spy.remove_owned_files)
    monkeypatch.setattr(
        agent_auth.sandbox_io,
        "run_materialization_script",
        spy.run_materialization_script,
    )
    return spy


def _ctx() -> Any:
    return SimpleNamespace(sandbox=SimpleNamespace(id=uuid.uuid4()), target=object())


class TestMaterializeAgentAuth:
    @pytest.mark.asyncio
    async def test_writes_state_and_manifest_when_changed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        inputs = _inputs((_selection(harness="claude", source_kind="gateway"),))

        async def fake_load(db: object, *, user_id: uuid.UUID, surface: str = "cloud") -> Any:
            return inputs

        monkeypatch.setattr(agent_auth, "_load_state_inputs", fake_load)
        spy = _install_spy(monkeypatch, previous_manifest=None)

        await agent_auth.materialize_agent_auth(object(), ctx=_ctx(), user_id=USER_ID)

        assert [write["path"] for write in spy.writes] == [
            paths.agent_auth_state_path(),
            paths.agent_auth_manifest_path(),
        ]
        assert all(write["mode"] == "600" for write in spy.writes)
        state = json.loads(str(spy.writes[0]["content"]))
        assert state["version"] == 2
        assert state["revision"] == REVISION
        assert state["harnesses"][0]["sources"][0]["key"] == "sk-litellm-vk"
        manifest = json.loads(str(spy.writes[1]["content"]))
        assert manifest["fingerprint"] == agent_auth.agent_auth_state_fingerprint(state)
        assert spy.removed == set()

    @pytest.mark.asyncio
    async def test_unchanged_fingerprint_skips_writes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        inputs = _inputs((_selection(harness="claude", source_kind="gateway"),))
        _, fingerprint = agent_auth.render_agent_auth_state(inputs)

        async def fake_load(db: object, *, user_id: uuid.UUID, surface: str = "cloud") -> Any:
            return inputs

        monkeypatch.setattr(agent_auth, "_load_state_inputs", fake_load)
        spy = _install_spy(monkeypatch, previous_manifest={"fingerprint": fingerprint})

        await agent_auth.materialize_agent_auth(object(), ctx=_ctx(), user_id=USER_ID)

        assert spy.writes == []
        assert spy.removed == set()
        assert spy.read_count == 1

    @pytest.mark.asyncio
    async def test_no_resolvable_sources_deletes_state_file(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A cloud selection whose only source is unsatisfiable resolves to zero
        # harnesses -> the file is deleted (empty renders to native; the runtime
        # launcher fail-closes cloud on its own).
        inputs = _inputs(
            (_selection(harness="claude", source_kind="gateway"),),
            enrollment_sync_status="pending",
            gateway_virtual_key=None,
        )

        async def fake_load(db: object, *, user_id: uuid.UUID, surface: str = "cloud") -> Any:
            return inputs

        monkeypatch.setattr(agent_auth, "_load_state_inputs", fake_load)
        spy = _install_spy(monkeypatch, previous_manifest=None)

        await agent_auth.materialize_agent_auth(object(), ctx=_ctx(), user_id=USER_ID)

        assert spy.writes == []
        assert spy.removed == {
            paths.agent_auth_state_path(),
            paths.agent_auth_manifest_path(),
        }

    @pytest.mark.asyncio
    async def test_bad_gateway_still_purges_revoked_key_and_writes_rest(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An unsatisfiable gateway source must not abort the reconcile: a
        # previously-materialized (now revoked) api_key is purged and the
        # satisfiable rest is written even though the gateway fails.
        revoked_id = uuid.uuid4()
        live_id = uuid.uuid4()
        inputs = _inputs(
            (
                _selection(harness="claude", source_kind="gateway"),
                _selection(
                    harness="codex",
                    source_kind="api_key",
                    api_key_id=revoked_id,
                    env_var_name="OPENAI_API_KEY",
                ),
                _selection(
                    harness="grok",
                    source_kind="api_key",
                    api_key_id=live_id,
                    env_var_name="XAI_API_KEY",
                ),
            ),
            api_key_values={live_id: "sk-live"},
            enrollment_sync_status="pending",
            gateway_virtual_key=None,
        )

        async def fake_load(db: object, *, user_id: uuid.UUID, surface: str = "cloud") -> Any:
            return inputs

        monkeypatch.setattr(agent_auth, "_load_state_inputs", fake_load)
        spy = _install_spy(monkeypatch, previous_manifest={"fingerprint": "stale"})

        await agent_auth.materialize_agent_auth(object(), ctx=_ctx(), user_id=USER_ID)

        assert spy.removed == set()
        state = json.loads(str(spy.writes[0]["content"]))
        assert [entry["harness_kind"] for entry in state["harnesses"]] == ["grok"]
        serialized = json.dumps(state)
        assert "sk-live" in serialized
        assert str(revoked_id) not in serialized
