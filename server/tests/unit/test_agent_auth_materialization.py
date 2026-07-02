"""Unit tests for cloud agent-auth state rendering and reconciliation."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.db.store.agent_gateway import AgentAuthRouteSelectionRecord
from proliferate.server.cloud.materialization import paths
from proliferate.server.cloud.materialization.materialize import agent_auth

USER_ID = uuid.uuid4()
NOW = datetime(2026, 7, 1, tzinfo=UTC)


def _selection(
    *,
    harness: str,
    surface: str = "cloud",
    route: str = "gateway",
    api_key_id: uuid.UUID | None = None,
    revision: int = 1,
    slot: str = "primary",
) -> AgentAuthRouteSelectionRecord:
    return AgentAuthRouteSelectionRecord(
        id=uuid.uuid4(),
        user_id=USER_ID,
        harness_kind=harness,
        surface=surface,
        route=route,
        api_key_id=api_key_id,
        revision=revision,
        created_at=NOW,
        updated_at=NOW,
        slot=slot,
    )


def _inputs(
    selections: tuple[AgentAuthRouteSelectionRecord, ...],
    *,
    api_key_secrets: dict[uuid.UUID, tuple[str, str]] | None = None,
    enrollment_sync_status: str | None = "synced",
    gateway_virtual_key: str | None = "sk-litellm-vk",
    gateway_base_url: str | None = "https://llm.proliferate.ai",
) -> agent_auth.AgentAuthStateInputs:
    return agent_auth.AgentAuthStateInputs(
        user_id=USER_ID,
        selections=selections,
        api_key_secrets=api_key_secrets or {},
        enrollment_sync_status=enrollment_sync_status,
        gateway_virtual_key=gateway_virtual_key,
        gateway_base_url=gateway_base_url,
    )


class TestRenderAgentAuthState:
    def test_gateway_and_api_key_selection_shapes(self) -> None:
        key_id = uuid.uuid4()
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", route="gateway", revision=3),
                    _selection(
                        harness="codex",
                        route="api_key",
                        api_key_id=key_id,
                        revision=7,
                    ),
                ),
                api_key_secrets={key_id: ("openai", "sk-openai-raw")},
            )
        )
        assert state == {
            "revision": 7,
            "user_id": str(USER_ID),
            "selections": [
                {
                    "harness": "claude",
                    "route": "gateway",
                    "slot": "primary",
                    "base_url": "https://llm.proliferate.ai",
                    "key": "sk-litellm-vk",
                },
                {
                    "harness": "codex",
                    "route": "api_key",
                    "slot": "primary",
                    "provider": "openai",
                    "key": "sk-openai-raw",
                },
            ],
        }
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)

    def test_opencode_multi_slot_selections_all_materialize(self) -> None:
        anthropic_id = uuid.uuid4()
        xai_id = uuid.uuid4()
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="opencode", route="gateway", slot="gateway", revision=2),
                    _selection(
                        harness="opencode",
                        route="api_key",
                        api_key_id=anthropic_id,
                        slot="anthropic",
                        revision=5,
                    ),
                    _selection(
                        harness="opencode",
                        route="api_key",
                        api_key_id=xai_id,
                        slot="xai",
                        revision=3,
                    ),
                ),
                api_key_secrets={
                    anthropic_id: ("anthropic", "sk-ant-raw"),
                    xai_id: ("xai", "xai-raw"),
                },
            )
        )
        assert state == {
            "revision": 5,
            "user_id": str(USER_ID),
            "selections": [
                {
                    "harness": "opencode",
                    "route": "api_key",
                    "slot": "anthropic",
                    "provider": "anthropic",
                    "key": "sk-ant-raw",
                },
                {
                    "harness": "opencode",
                    "route": "gateway",
                    "slot": "gateway",
                    "base_url": "https://llm.proliferate.ai",
                    "key": "sk-litellm-vk",
                },
                {
                    "harness": "opencode",
                    "route": "api_key",
                    "slot": "xai",
                    "provider": "xai",
                    "key": "xai-raw",
                },
            ],
        }
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)

    def test_local_selections_are_ignored(self) -> None:
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", surface="local", route="native"),
                    _selection(harness="codex", surface="local", route="gateway"),
                )
            )
        )
        assert state is None
        assert fingerprint == ""

    def test_fingerprint_is_stable_across_renders(self) -> None:
        selections = (_selection(harness="claude", route="gateway", revision=2),)
        first = agent_auth.render_agent_auth_state(_inputs(selections))
        second = agent_auth.render_agent_auth_state(_inputs(selections))
        assert first == second
        assert first[1]

    def test_fingerprint_changes_when_virtual_key_rotates(self) -> None:
        selections = (_selection(harness="claude", route="gateway"),)
        _, before = agent_auth.render_agent_auth_state(_inputs(selections))
        _, after = agent_auth.render_agent_auth_state(
            _inputs(selections, gateway_virtual_key="sk-litellm-rotated")
        )
        assert before != after

    def test_gateway_without_public_base_url_is_failclosed_marker(self) -> None:
        # Unconfigured public base URL: the gateway selection is skipped, but
        # because a cloud selection exists the file is a fail-closed marker
        # (empty selections), never a deletion.
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", route="gateway", revision=2),),
                gateway_base_url=None,
            )
        )
        assert state == {"revision": 2, "user_id": str(USER_ID), "selections": []}
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)

    def test_gateway_with_unsynced_enrollment_is_failclosed_marker(self) -> None:
        for status in ("pending", "failed", None):
            state, _ = agent_auth.render_agent_auth_state(
                _inputs(
                    (_selection(harness="claude", route="gateway"),),
                    enrollment_sync_status=status,
                )
            )
            assert state is not None
            assert state["selections"] == []

    def test_gateway_without_virtual_key_is_failclosed_marker(self) -> None:
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", route="gateway"),),
                gateway_virtual_key=None,
            )
        )
        assert state is not None
        assert state["selections"] == []

    def test_unsatisfiable_gateway_still_renders_satisfiable_api_key(self) -> None:
        # Finding 2: an unsatisfiable gateway selection must not drop the
        # satisfiable api_key rest — rendering the rest is what removes stale
        # key material at this pass.
        live_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", route="gateway"),
                    _selection(harness="codex", route="api_key", api_key_id=live_id),
                ),
                api_key_secrets={live_id: ("openai", "sk-live")},
                enrollment_sync_status="pending",
                gateway_virtual_key=None,
            )
        )
        assert state is not None
        assert [entry["harness"] for entry in state["selections"]] == ["codex"]

    def test_revoked_api_key_selection_is_omitted(self) -> None:
        revoked_id = uuid.uuid4()
        live_id = uuid.uuid4()
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", route="api_key", api_key_id=revoked_id),
                    _selection(harness="codex", route="api_key", api_key_id=live_id),
                ),
                api_key_secrets={live_id: ("openai", "sk-live")},
                enrollment_sync_status=None,
                gateway_virtual_key=None,
            )
        )
        assert state is not None
        assert [entry["harness"] for entry in state["selections"]] == ["codex"]

    def test_only_revoked_api_key_selections_render_failclosed_marker(self) -> None:
        # Finding 1: the sole api_key selection's key was revoked. Rendering
        # must NOT collapse to ``None`` (which deletes the file and lets the
        # reader fall through to native); it must be a fail-closed marker.
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(
                        harness="claude",
                        route="api_key",
                        api_key_id=uuid.uuid4(),
                        revision=5,
                    ),
                ),
                enrollment_sync_status=None,
                gateway_virtual_key=None,
            )
        )
        assert state == {"revision": 5, "user_id": str(USER_ID), "selections": []}
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)


class TestRenderLocalSurface:
    def test_local_surface_renders_native_api_key_and_gateway(self) -> None:
        key_id = uuid.uuid4()
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs(
                (
                    _selection(harness="claude", surface="local", route="native", revision=2),
                    _selection(
                        harness="codex",
                        surface="local",
                        route="api_key",
                        api_key_id=key_id,
                        revision=6,
                    ),
                    _selection(harness="grok", surface="local", route="gateway", revision=4),
                ),
                api_key_secrets={key_id: ("openai", "sk-openai-raw")},
            ),
            surface="local",
        )
        assert state == {
            "revision": 6,
            "user_id": str(USER_ID),
            "selections": [
                {
                    "harness": "claude",
                    "route": "native",
                    "slot": "primary",
                },
                {
                    "harness": "codex",
                    "route": "api_key",
                    "slot": "primary",
                    "provider": "openai",
                    "key": "sk-openai-raw",
                },
                {
                    "harness": "grok",
                    "route": "gateway",
                    "slot": "primary",
                    "base_url": "https://llm.proliferate.ai",
                    "key": "sk-litellm-vk",
                },
            ],
        }
        assert fingerprint == agent_auth.agent_auth_state_fingerprint(state)

    def test_cloud_selections_are_ignored_on_local_surface(self) -> None:
        state, fingerprint = agent_auth.render_agent_auth_state(
            _inputs((_selection(harness="claude", surface="cloud", route="gateway"),)),
            surface="local",
        )
        assert state is None
        assert fingerprint == ""

    def test_native_selection_never_carries_key_material(self) -> None:
        state, _ = agent_auth.render_agent_auth_state(
            _inputs(
                (_selection(harness="claude", surface="local", route="native", revision=3),)
            ),
            surface="local",
        )
        assert state is not None
        serialized = json.dumps(state)
        assert "sk-litellm-vk" not in serialized
        assert "key" not in state["selections"][0]  # type: ignore[index]

    def test_default_surface_stays_cloud(self) -> None:
        selections = (_selection(harness="claude", route="gateway", revision=2),)
        explicit = agent_auth.render_agent_auth_state(_inputs(selections), surface="cloud")
        implicit = agent_auth.render_agent_auth_state(_inputs(selections))
        assert explicit == implicit


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
        selections = (_selection(harness="claude", route="gateway", revision=4),)
        inputs = _inputs(selections)

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
        assert state["revision"] == 4
        assert state["selections"][0]["key"] == "sk-litellm-vk"
        manifest = json.loads(str(spy.writes[1]["content"]))
        assert manifest["fingerprint"] == agent_auth.agent_auth_state_fingerprint(state)
        assert spy.removed == set()

    @pytest.mark.asyncio
    async def test_unchanged_fingerprint_skips_writes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        selections = (_selection(harness="claude", route="gateway", revision=4),)
        inputs = _inputs(selections)
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
    async def test_zero_cloud_selections_deletes_state_file(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        inputs = _inputs((_selection(harness="claude", surface="local", route="native"),))

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
    async def test_all_selections_unsatisfiable_writes_failclosed_marker(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Finding 1: a cloud selection whose only api_key was revoked must WRITE
        # a fail-closed marker, never delete the state file (deletion would let
        # the reader fall through to native).
        inputs = _inputs(
            (
                _selection(
                    harness="claude",
                    route="api_key",
                    api_key_id=uuid.uuid4(),
                    revision=9,
                ),
            ),
            enrollment_sync_status=None,
            gateway_virtual_key=None,
        )

        async def fake_load(db: object, *, user_id: uuid.UUID, surface: str = "cloud") -> Any:
            return inputs

        monkeypatch.setattr(agent_auth, "_load_state_inputs", fake_load)
        spy = _install_spy(monkeypatch, previous_manifest=None)

        await agent_auth.materialize_agent_auth(object(), ctx=_ctx(), user_id=USER_ID)

        assert [write["path"] for write in spy.writes] == [
            paths.agent_auth_state_path(),
            paths.agent_auth_manifest_path(),
        ]
        assert spy.removed == set()
        state = json.loads(str(spy.writes[0]["content"]))
        assert state == {"revision": 9, "user_id": str(USER_ID), "selections": []}

    @pytest.mark.asyncio
    async def test_bad_gateway_still_purges_revoked_key_and_writes_rest(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Finding 2: an unsatisfiable gateway selection must not abort the whole
        # reconcile. A previously-materialized (now revoked) api_key must be
        # purged and the satisfiable rest written, even though gateway fails.
        revoked_id = uuid.uuid4()
        live_id = uuid.uuid4()
        inputs = _inputs(
            (
                _selection(harness="claude", route="gateway"),
                _selection(harness="codex", route="api_key", api_key_id=revoked_id),
                _selection(harness="grok", route="api_key", api_key_id=live_id),
            ),
            api_key_secrets={live_id: ("xai", "sk-live")},
            enrollment_sync_status="pending",
            gateway_virtual_key=None,
        )

        async def fake_load(db: object, *, user_id: uuid.UUID, surface: str = "cloud") -> Any:
            return inputs

        monkeypatch.setattr(agent_auth, "_load_state_inputs", fake_load)
        # Stale prior fingerprint (from the pass that wrote the now-revoked key)
        # so the write path runs rather than the unchanged-fingerprint skip.
        spy = _install_spy(monkeypatch, previous_manifest={"fingerprint": "stale"})

        await agent_auth.materialize_agent_auth(object(), ctx=_ctx(), user_id=USER_ID)

        assert spy.removed == set()
        state = json.loads(str(spy.writes[0]["content"]))
        assert [entry["harness"] for entry in state["selections"]] == ["grok"]
        serialized = json.dumps(state)
        assert "sk-live" in serialized
        assert str(revoked_id) not in serialized
