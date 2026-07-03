"""Decisive end-to-end round-trip for the workspace-move (migration v2) stack.

One scenario, acting as the Desktop executor over HTTP, exercises the whole
local<->cloud<->local handoff on real infrastructure (a spawned local macOS
AnyHarness runtime + a real E2B sandbox driven through the real server API):

  1. Local: real Claude AND Codex sessions on one plain-dir workspace each
     learn a distinct codeword (both native, both harness-authed locally).
  2. Move local->cloud via the server API (server provisions the sandbox
     worktree; the test freezes+exports the local runtime and hands the archive
     to ``/install``, then ``/cutover`` + ``/complete``). One move carries both
     sessions.
  3. "Use it there": each migrated session keeps its native session id and its
     imported events in the sandbox, and recalls its own codeword when prompted
     -- proving BOTH the Claude transcript (CLAUDE_CONFIG_DIR mirror) and the
     Codex rollout (codex-local mirror) survived the isolated route-auth homes.
  4. Move cloud->local back (server exports from the sandbox; the test
     re-adopts the original local workspace with
     ``installMode=preserve_native_sessions``); each session recalls its
     codeword locally again.
  5. Both ``workspace_move`` rows end ``completed`` with
     ``canonical_side=destination``.

Skips cleanly without ``RUN_CLOUD_E2E=1`` (via the ``cloud_client`` fixture's
``require_live_cloud`` gate) and without an ``ANTHROPIC_API_KEY`` for the
sandbox's Claude. The Codex leg additionally requires an ``OPENAI_API_KEY`` (to
seed the sandbox codex api_key route) and a warm local codex-acp launcher +
``~/.codex/auth.json``; when either is absent the round-trip runs Claude-only
(``include_codex`` gate). Runs under ``make test-cloud-e2b``. Follows the
real-E2B harness conventions in ``test_provisioning.py`` / ``helpers/``.
"""

from __future__ import annotations

import contextlib
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as cloud_sandbox_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.mobility import (
    export_runtime_mobility_archive,
    install_runtime_mobility_archive,
    set_runtime_mobility_state,
)
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.materialization import service as materialization_service
from tests.e2e.cloud.helpers.auth import create_user_and_login, refresh_auth_session
from tests.e2e.cloud.helpers.config import ensure_cloud_runtime_binary_ready
from tests.e2e.cloud.helpers.github import (
    seed_github_app_repo_authority,
    seed_linked_github_account,
)
from tests.e2e.cloud.helpers.local_runtime import (
    cleanup_claude_project_slugs,
    cleanup_codex_rollouts,
    clone_repo_on_new_branch,
    delete_remote_branch,
    local_codex_agent_available,
    spawn_local_runtime,
)
from tests.e2e.cloud.helpers.mobility_runtime import (
    runtime_create_plain_workspace,
    runtime_create_session,
    runtime_get_session,
    runtime_list_events,
    runtime_list_sessions,
    runtime_prompt_and_collect,
    turn_contains_text,
    turn_transcript_text,
)
from tests.e2e.cloud.helpers.shared import AuthSession, CloudE2ETestError
from tests.e2e.cloud.helpers.workspaces import (
    create_ready_cloud_workspace,
    delete_cloud_workspace_quietly,
)

_LONG_OP_TIMEOUT_SECONDS = 900.0
_PROMPT_TIMEOUT_SECONDS = 180.0


@dataclass
class HarnessLeg:
    """One agent session carried through the round-trip on the shared workspace.

    Both a Claude and a Codex session live on the *same* local workspace, so a
    single move carries both; we recall each session's own distinct codeword to
    prove per-harness native resume survives the local<->cloud<->local handoff.
    """

    kind: str
    codeword: str
    session_id: str
    native_session_id: str


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.e2b
@pytest.mark.parametrize("provider_kind", ["e2b"])
async def test_workspace_move_round_trip_local_cloud_local(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
    tmp_path: Path,
) -> None:
    if not cloud_test_config.anthropic_api_key:
        pytest.skip(
            "ANTHROPIC_API_KEY is required so the migrated session's Claude can "
            "run inside the sandbox (local turns use native ~/.claude)."
        )
    ensure_cloud_runtime_binary_ready()

    run_id = uuid.uuid4().hex[:10]
    branch = f"mig-e2e-{run_id}"
    # Distinct codewords per harness so recall proves the *right* native session
    # survived (a resumed session leaking the other's word would be a false pass).
    codeword_claude = f"PLUM-{run_id.upper()}"
    codeword_codex = f"KIWI-{run_id.upper()}"
    # The Codex leg rides the same round-trip, but only when its prerequisites are
    # present: an OpenAI key to seed the sandbox codex api_key route (the Codex
    # twin of the Claude api_key seed) AND a warm local codex-acp launcher +
    # ~/.codex/auth.json for the local turns. Absent either, the round-trip still
    # proves the Claude leg; the live proof run has both.
    include_codex = bool(cloud_test_config.openai_api_key) and local_codex_agent_available()
    owner = cloud_test_config.github_owner
    repo = cloud_test_config.github_repo
    token = cloud_test_config.github_token
    assert token is not None

    scratch_root = tmp_path / f"mig-e2e-{run_id}"
    scratch_root.mkdir(parents=True, exist_ok=True)
    clone_path = scratch_root / f"clone-{run_id}"

    auth = await create_user_and_login(cloud_client, db_session, email_prefix=f"mig-{run_id}")
    user_uuid = uuid.UUID(auth.user_id)

    local_runtime = None
    warmup_workspace_id: str | None = None
    destination_workspace_id: str | None = None
    provider_sandbox_id: str | None = None
    slug_markers = [run_id, scratch_root.name, clone_path.name]
    # Codex rollouts the local re-adopt mirrors into the ambient ~/.codex/sessions
    # (unlike Claude's isolated CLAUDE_CONFIG_DIR) -- cleaned by native id in teardown.
    codex_native_session_ids: list[str] = []

    try:
        # --- Prereqs: linked GitHub, sandbox Claude auth, repo config + cloud env ---
        await seed_linked_github_account(db_session, user_id=auth.user_id, access_token=token)
        await seed_github_app_repo_authority(
            db_session, user_id=auth.user_id, access_token=token, git_owner=owner
        )
        await _seed_sandbox_claude_api_key(cloud_client, auth, cloud_test_config.anthropic_api_key)
        if include_codex:
            assert cloud_test_config.openai_api_key is not None
            await _seed_sandbox_codex_api_key(
                cloud_client, auth, cloud_test_config.openai_api_key
            )
        # Configuring the cloud repo environment is what creates the repo_config
        # row on this branch (the standalone ``/repos/.../config`` endpoint the
        # earlier provisioning idiom used was removed by the Stack-1 cutover);
        # the move's logical identity is that same repo_config.
        await _put_repo_config(
            cloud_client, auth, owner=owner, repo=repo,
            base_branch=cloud_test_config.github_base_branch,
        )
        repo_config_id = await _require_repo_config_id(
            db_session, user_uuid, owner=owner, repo=repo
        )

        # A warmup cloud workspace boots the user's personal sandbox and
        # materializes its agent-auth (the move reuses that same sandbox).
        _, warmup = await create_ready_cloud_workspace(
            cloud_client,
            auth,
            db_session,
            cloud_test_config,
            provider_kind=provider_kind,
            branch_prefix=f"mig-warmup-{run_id}",
        )
        warmup_workspace_id = str(warmup["id"])
        provider_sandbox_id = await _sandbox_provider_id(db_session, user_uuid)

        # Materialize the claude api_key agent-auth (state.json) into the now-booted
        # sandbox. In production this rides fire-and-forget background tasks
        # (schedule_materialize_agent_auth after the route-selection write, and the
        # materialize_sandbox bootstrap) -- neither runs under the in-process ASGI
        # test harness, so do it synchronously here. Without it the migrated
        # session's Claude launches with no credentials in the sandbox and every
        # turn fails with a "-32000 Authentication required" agent error.
        await materialization_service.materialize_agent_auth(db_session, user_id=user_uuid)

        # --- Local side: clone + branch + a real Claude session that learns the codeword ---
        base_sha = clone_repo_on_new_branch(
            owner=owner,
            repo=repo,
            base_branch=cloud_test_config.github_base_branch,
            branch=branch,
            token=token,
            dest=clone_path,
        )
        local_runtime = spawn_local_runtime("local", scratch_root=scratch_root)
        slug_markers.extend(local_runtime.markers)
        local_url, local_token = local_runtime.base_url, local_runtime.access_token

        resolved = await runtime_create_plain_workspace(
            local_url, local_token, path=str(clone_path)
        )
        local_ws_id = str(resolved["workspace"]["id"])

        # Both harness sessions live on the SAME workspace, so one move carries
        # both. Each learns its own codeword; recall in the sandbox (after move 1)
        # and locally (after move 2) proves each harness's native session resumed.
        harness_specs = [("claude", codeword_claude)]
        if include_codex:
            harness_specs.append(("codex", codeword_codex))

        legs: list[HarnessLeg] = []
        for kind, codeword in harness_specs:
            created = await runtime_create_session(
                local_url, local_token, workspace_id=local_ws_id, agent_kind=kind
            )
            leg_session_id = str(created["id"])
            teach = await runtime_prompt_and_collect(
                local_url,
                local_token,
                leg_session_id,
                f"Remember this codeword for later: {codeword}. Do not edit any files. "
                "Reply with exactly: STORED",
                timeout_seconds=_PROMPT_TIMEOUT_SECONDS,
            )
            assert turn_contains_text(teach, "STORED"), (
                f"Local {kind} did not store the codeword."
            )
            leg_native = str(
                (await runtime_get_session(local_url, local_token, leg_session_id))[
                    "nativeSessionId"
                ]
            )
            assert leg_native
            if kind == "codex":
                codex_native_session_ids.append(leg_native)
            legs.append(
                HarnessLeg(
                    kind=kind,
                    codeword=codeword,
                    session_id=leg_session_id,
                    native_session_id=leg_native,
                )
            )
            print(
                f"[E2E-DIAG] taught {kind} leg session={leg_session_id} native={leg_native}",
                flush=True,
            )
        assert any(leg.kind == "claude" for leg in legs)

        # --- Move 1: local -> cloud ------------------------------------------
        move1 = await _start_move(
            cloud_client,
            auth,
            repo_config_id=repo_config_id,
            branch=branch,
            base_commit_sha=base_sha,
            source=_local_ref(run_id, local_ws_id),
            destination={"kind": "cloud"},
            idempotency_key=f"{run_id}-local-to-cloud",
        )
        assert move1["phase"] == "destination_ready"
        move1_id = move1["id"]
        destination_workspace_id = str(move1["destinationRef"]["cloudWorkspaceId"])
        sandbox_ws_id = str(move1["destinationRef"]["anyharnessWorkspaceId"])

        # Freeze + export on the local runtime (requireCleanGitState + expected guards).
        await set_runtime_mobility_state(
            local_url, local_token,
            anyharness_workspace_id=local_ws_id, mode="frozen_for_handoff", handoff_op_id=move1_id,
        )
        await _assert_export_guard_rejects_mismatch(
            local_url, local_token, local_ws_id, base_sha, branch
        )
        archive1 = await export_runtime_mobility_archive(
            local_url, local_token,
            anyharness_workspace_id=local_ws_id,
            expected_handoff_op_id=move1_id,
            expected_base_commit_sha=base_sha,
            expected_branch_name=branch,
        )

        install1 = await _move_phase(
            cloud_client, auth, move1_id, "install", body={"archive": archive1}
        )
        assert install1["phase"] == "installed"
        cutover1 = await _move_phase(cloud_client, auth, move1_id, "cutover")
        assert cutover1["phase"] == "cutover" and cutover1["canonicalSide"] == "destination"

        # Source fate: the local ws is a plain directory -> remote_owned only (files untouched).
        await set_runtime_mobility_state(
            local_url, local_token, anyharness_workspace_id=local_ws_id, mode="remote_owned"
        )
        complete1 = await _move_phase(cloud_client, auth, move1_id, "complete")
        assert complete1["phase"] == "completed" and complete1["canonicalSide"] == "destination"

        # --- Use it there: the migrated session resumes natively in the sandbox ---
        _archive_native_ids = [
            (s.get("session", {}).get("id"), s.get("session", {}).get("nativeSessionId"))
            for s in (archive1.get("sessions") or [])
            if isinstance(s, dict)
        ]
        print(f"[E2E-DIAG] archive1 session native ids: {_archive_native_ids}", flush=True)
        sandbox_url, sandbox_token = await _sandbox_runtime_access(db_session, user_uuid)
        await _dump_sandbox_agent_auth_diag(provider_kind, provider_sandbox_id, "pre-recall")
        for leg in legs:
            sandbox_session = await runtime_get_session(
                sandbox_url, sandbox_token, leg.session_id
            )
            print(
                f"[E2E-DIAG] sandbox {leg.kind} session keys={sorted(sandbox_session.keys())} "
                f"nativeSessionId={sandbox_session.get('nativeSessionId')!r} "
                f"expected={leg.native_session_id!r}",
                flush=True,
            )
            assert sandbox_session.get("nativeSessionId") == leg.native_session_id, (
                f"{leg.kind} session lost its native id crossing into the sandbox."
            )
            assert (
                len(await runtime_list_events(sandbox_url, sandbox_token, leg.session_id)) > 0
            )

            try:
                recall_cloud = await runtime_prompt_and_collect(
                    sandbox_url, sandbox_token, leg.session_id,
                    "What is the codeword I asked you to remember? Do not edit any files. "
                    "Reply with exactly that word and nothing else.",
                    timeout_seconds=_PROMPT_TIMEOUT_SECONDS,
                )
            except Exception:
                await _dump_sandbox_agent_auth_diag(
                    provider_kind, provider_sandbox_id, f"recall-fail-{leg.kind}"
                )
                raise
            assert turn_contains_text(recall_cloud, leg.codeword), (
                f"Migrated {leg.kind} session did not recall the codeword in the sandbox."
            )
            print(
                f"[E2E-EVIDENCE] sandbox {leg.kind} recall "
                f"(native_session_id={leg.native_session_id}): "
                f"{turn_transcript_text(recall_cloud)!r}",
                flush=True,
            )

        # --- Move 2: cloud -> local (round trip home via re-adopt) -----------
        move2 = await _start_move(
            cloud_client,
            auth,
            repo_config_id=repo_config_id,
            branch=branch,
            base_commit_sha=base_sha,
            source={
                "kind": "cloud",
                "cloudWorkspaceId": destination_workspace_id,
                "anyharnessWorkspaceId": sandbox_ws_id,
            },
            destination=_local_ref(run_id, local_ws_id),
            idempotency_key=f"{run_id}-cloud-to-local",
        )
        assert move2["phase"] == "destination_ready"
        move2_id = move2["id"]

        export2 = await _move_phase(cloud_client, auth, move2_id, "export")
        archive2 = export2["archive"]

        # Re-adopt the original local workspace (still remote_owned) in place.
        readopt = await install_runtime_mobility_archive(
            local_url, local_token,
            anyharness_workspace_id=local_ws_id,
            archive=archive2,
            operation_id=move2_id,
            install_mode="preserve_native_sessions",
        )
        for leg in legs:
            assert leg.session_id in readopt.imported_session_ids, (
                f"{leg.kind} session was not re-imported into the local workspace."
            )

        install2 = await _move_phase(cloud_client, auth, move2_id, "install", body={})
        assert install2["phase"] == "installed"
        cutover2 = await _move_phase(cloud_client, auth, move2_id, "cutover")
        assert cutover2["canonicalSide"] == "destination"
        complete2 = await _move_phase(cloud_client, auth, move2_id, "complete")
        assert complete2["phase"] == "completed" and complete2["canonicalSide"] == "destination"

        # Install leaves the workspace remote_owned; flip to normal to prompt.
        await set_runtime_mobility_state(
            local_url, local_token, anyharness_workspace_id=local_ws_id, mode="normal"
        )
        sessions_local = await runtime_list_sessions(
            local_url, local_token, workspace_id=local_ws_id
        )
        local_session_ids = {str(item.get("id")) for item in sessions_local}
        for leg in legs:
            assert leg.session_id in local_session_ids, (
                f"{leg.kind} session is missing from the re-adopted workspace."
            )
            home_session = await runtime_get_session(local_url, local_token, leg.session_id)
            assert str(home_session["nativeSessionId"]) == leg.native_session_id, (
                f"{leg.kind} session lost its native id coming home."
            )
            recall_local = await runtime_prompt_and_collect(
                local_url, local_token, leg.session_id,
                "One more time: what is the codeword? Do not edit any files. "
                "Reply with exactly that word and nothing else.",
                timeout_seconds=_PROMPT_TIMEOUT_SECONDS,
            )
            assert turn_contains_text(recall_local, leg.codeword), (
                f"Re-adopted {leg.kind} session did not recall the codeword locally."
            )
            print(
                f"[E2E-EVIDENCE] local {leg.kind} recall after round-trip: "
                f"{turn_transcript_text(recall_local)!r}",
                flush=True,
            )

        # --- Ledger + cloud-source cleanup assertions ------------------------
        for label, move_id in (("local->cloud", move1_id), ("cloud->local", move2_id)):
            row = await _get_move(cloud_client, auth, move_id)
            assert row["phase"] == "completed", move_id
            assert row["canonicalSide"] == "destination", move_id
            print(
                f"[E2E-EVIDENCE] workspace_move {label} id={move_id} "
                f"phase={row['phase']} canonicalSide={row['canonicalSide']} "
                f"source={row['sourceKind']}->dest={row['destinationKind']}",
                flush=True,
            )

        archived = await cloud_workspace_store.get_cloud_workspace_for_user(
            db_session, user_uuid, uuid.UUID(destination_workspace_id)
        )
        assert archived is None or archived.archived_at is not None, (
            "cloud->local complete should archive the source cloud workspace."
        )

    finally:
        await _teardown(
            cloud_client,
            auth,
            db_session,
            provider_kind=provider_kind,
            local_runtime=local_runtime,
            slug_markers=slug_markers,
            codex_native_session_ids=codex_native_session_ids,
            provider_sandbox_id=provider_sandbox_id,
            workspace_ids=[warmup_workspace_id, destination_workspace_id],
            owner=owner,
            repo=repo,
            branch=branch,
            token=token,
            clone_path=clone_path,
        )


# --- server API helpers ------------------------------------------------------


async def _server_json(
    client: httpx.AsyncClient,
    auth: AuthSession,
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    timeout: float = _LONG_OP_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    for attempt in range(2):
        response = await client.request(
            method, path, headers=auth.headers, json=body, timeout=timeout
        )
        if response.status_code == 401 and attempt == 0:
            await refresh_auth_session(client, auth=auth)
            continue
        if response.status_code >= 400:
            raise CloudE2ETestError(
                f"{method} {path} failed ({response.status_code}): {response.text.strip()}"
            )
        if response.status_code == 204 or not response.content:
            return {}
        return response.json()
    raise CloudE2ETestError(f"{method} {path} kept returning 401 after refresh.")


def _local_ref(run_id: str, anyharness_workspace_id: str) -> dict[str, Any]:
    return {
        "kind": "local",
        "desktopInstallId": f"e2e-{run_id}",
        "anyharnessWorkspaceId": anyharness_workspace_id,
    }


async def _start_move(
    client: httpx.AsyncClient,
    auth: AuthSession,
    *,
    repo_config_id: str,
    branch: str,
    base_commit_sha: str,
    source: dict[str, Any],
    destination: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    return await _server_json(
        client,
        auth,
        "POST",
        "/v1/cloud/workspace-moves",
        body={
            "repoConfigId": repo_config_id,
            "branch": branch,
            "baseCommitSha": base_commit_sha,
            "source": source,
            "destination": destination,
            "idempotencyKey": idempotency_key,
        },
    )


async def _move_phase(
    client: httpx.AsyncClient,
    auth: AuthSession,
    move_id: str,
    phase: str,
    *,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await _server_json(
        client, auth, "POST", f"/v1/cloud/workspace-moves/{move_id}/{phase}", body=body or {}
    )


async def _get_move(client: httpx.AsyncClient, auth: AuthSession, move_id: str) -> dict[str, Any]:
    return await _server_json(
        client, auth, "GET", f"/v1/cloud/workspace-moves/{move_id}", timeout=60.0
    )


async def _put_repo_config(
    client: httpx.AsyncClient, auth: AuthSession, *, owner: str, repo: str, base_branch: str
) -> None:
    # Saving the cloud repo environment upserts the underlying repo_config and
    # the cloud RepoEnvironment the move needs (``_require_cloud_repo_environment``).
    # This is the same call ``create_cloud_workspace`` makes; running it here just
    # pins the repo_config before we read its id, and the later warmup re-upserts
    # it idempotently.
    await _server_json(
        client,
        auth,
        "PUT",
        f"/v1/cloud/repositories/{owner}/{repo}/environment",
        body={
            "kind": "cloud",
            "gitProvider": "github",
            "defaultBranch": base_branch,
            "setupScript": "",
            "runCommand": "",
        },
        timeout=120.0,
    )


async def _seed_sandbox_claude_api_key(
    client: httpx.AsyncClient, auth: AuthSession, anthropic_api_key: str
) -> None:
    """Give the user's cloud sandbox a Claude api-key route so the migrated
    session can run Claude there (the authorized fallback from the spec's
    §3 sandbox agent-auth path -- done via the product API, not raw file
    injection). Local turns use native ~/.claude and need nothing here."""
    key = await _server_json(
        client,
        auth,
        "POST",
        "/v1/cloud/agent-gateway/api-keys",
        body={"provider": "anthropic", "displayName": "mig-e2e", "secret": anthropic_api_key},
        timeout=60.0,
    )
    await _server_json(
        client,
        auth,
        "PUT",
        "/v1/cloud/agent-gateway/route-selections/claude/cloud",
        body={"route": "api_key", "apiKeyId": key["id"], "slot": "primary"},
        timeout=60.0,
    )


async def _seed_sandbox_codex_api_key(
    client: httpx.AsyncClient, auth: AuthSession, openai_api_key: str
) -> None:
    """Codex twin of :func:`_seed_sandbox_claude_api_key`.

    The migrated Codex rollout is only visible to ``resume`` when the sandbox
    launch scans the runtime-local ``codex-local`` CODEX_HOME (where the install
    mirror lands). The api_key route is exactly the route that keeps that home:
    it sets ``OPENAI_API_KEY`` and does NOT override ``CODEX_HOME`` (the gateway
    route would repoint CODEX_HOME at a revision dir the install can't pre-seed).
    So route Codex through api_key/openai, mirroring the Claude api_key seed.
    Local Codex turns use the machine's native ~/.codex login and need nothing
    here."""
    key = await _server_json(
        client,
        auth,
        "POST",
        "/v1/cloud/agent-gateway/api-keys",
        body={"provider": "openai", "displayName": "mig-e2e-codex", "secret": openai_api_key},
        timeout=60.0,
    )
    await _server_json(
        client,
        auth,
        "PUT",
        "/v1/cloud/agent-gateway/route-selections/codex/cloud",
        body={"route": "api_key", "apiKeyId": key["id"], "slot": "primary"},
        timeout=60.0,
    )


async def _assert_export_guard_rejects_mismatch(
    runtime_url: str, access_token: str, workspace_id: str, base_sha: str, branch: str
) -> None:
    """E1b guard chain: a mismatched handoff-op is refused even when frozen+clean."""
    with pytest.raises(CloudRuntimeReconnectError):
        await export_runtime_mobility_archive(
            runtime_url,
            access_token,
            anyharness_workspace_id=workspace_id,
            expected_handoff_op_id="not-the-real-handoff-op",
            expected_base_commit_sha=base_sha,
            expected_branch_name=branch,
        )


# --- database + resource helpers ---------------------------------------------


async def _require_repo_config_id(
    db: AsyncSession, user_id: uuid.UUID, *, owner: str, repo: str
) -> str:
    config = await repositories_store.get_repo_config_for_user(
        db, user_id=user_id, git_provider="github", git_owner=owner, git_repo_name=repo
    )
    if config is None:
        raise CloudE2ETestError("Repo config was not created for the test user.")
    return str(config.id)


async def _sandbox_row(db: AsyncSession, user_id: uuid.UUID) -> CloudSandbox | None:
    return (
        await db.execute(
            select(CloudSandbox).where(
                CloudSandbox.owner_user_id == user_id,
                CloudSandbox.destroyed_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def _sandbox_provider_id(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    row = await _sandbox_row(db, user_id)
    return row.provider_sandbox_id if row is not None else None


async def _dump_sandbox_agent_auth_diag(
    provider_kind: str, provider_sandbox_id: str | None, label: str
) -> None:
    """TEMP DIAG: dump state.json (keys redacted), agent-auth tree, runtime log."""
    if not provider_sandbox_id:
        print(f"[E2E-DIAG:{label}] no provider_sandbox_id", flush=True)
        return
    try:
        provider = get_sandbox_provider(provider_kind)
        handle = await provider.connect_running_sandbox(provider_sandbox_id)
    except Exception as exc:  # noqa: BLE001
        print(f"[E2E-DIAG:{label}] connect failed: {exc!r}", flush=True)
        return
    redact = (
        "python3 -c \"import json,sys;"
        "d=json.load(sys.stdin);"
        "print('revision',d.get('revision'));"
        "print(json.dumps([{k:(v if k!='key' else '<'+str(len(v))+'-chars>') "
        "for k,v in s.items()} for s in d.get('selections',[])],indent=2))\""
    )
    cmds = {
        "state.json": (
            "cat /home/user/.proliferate/anyharness/agent-auth/state.json 2>/dev/null "
            f"| {redact} 2>&1 || echo '<no state.json>'; true"
        ),
        "agent-auth tree": (
            "ls -laR /home/user/.proliferate/anyharness/agent-auth 2>&1 | head -60; true"
        ),
        "anyharness.log": (
            "tail -400 /home/user/anyharness.log 2>&1 | grep -iE "
            "'route_auth|route-auth|Authentication|load_session|ACP|api_key|"
            "SelectionMissing|CLAUDE_CONFIG|ANTHROPIC|resolve_launch|native' "
            "| tail -60; true"
        ),
    }
    for name, cmd in cmds.items():
        try:
            res = await provider.run_command(handle, cmd, timeout_seconds=30)
            stdout = getattr(res, "stdout", None)
            if stdout is None:
                stdout = str(res)
        except Exception as exc:  # noqa: BLE001
            stdout = f"<run_command failed: {exc!r}>"
        print(f"[E2E-DIAG:{label}] === {name} ===\n{stdout}", flush=True)


async def _sandbox_runtime_access(db: AsyncSession, user_id: uuid.UUID) -> tuple[str, str]:
    sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(db, user_id)
    if sandbox is None:
        raise CloudE2ETestError("Personal cloud sandbox is missing after the move.")
    runtime_url, runtime_token, _data_key = (
        await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(sandbox)
    )
    return runtime_url, runtime_token


async def _teardown(
    client: httpx.AsyncClient,
    auth: AuthSession,
    db: AsyncSession,
    *,
    provider_kind: str,
    local_runtime: Any,
    slug_markers: list[str],
    codex_native_session_ids: list[str],
    provider_sandbox_id: str | None,
    workspace_ids: list[str | None],
    owner: str,
    repo: str,
    branch: str,
    token: str | None,
    clone_path: Path,
) -> None:
    if local_runtime is not None:
        _safely(local_runtime.close)
    _safely(lambda: cleanup_claude_project_slugs(slug_markers))
    _safely(lambda: cleanup_codex_rollouts(codex_native_session_ids))

    for workspace_id in workspace_ids:
        if workspace_id:
            await _safely_async(
                delete_cloud_workspace_quietly(client, auth, workspace_id, db_session=db)
            )

    await _safely_async(
        _server_json(client, auth, "DELETE", "/v1/cloud/cloud-sandbox", timeout=120.0)
    )
    if provider_sandbox_id:
        provider = get_sandbox_provider(provider_kind)
        await _safely_async(provider.destroy_sandbox(provider_sandbox_id))

    if token:
        _safely(
            lambda: delete_remote_branch(
                owner=owner, repo=repo, branch=branch, token=token, cwd=clone_path
            )
        )


def _safely(fn: Any) -> None:
    # Cleanup must never mask the test result.
    with contextlib.suppress(Exception):
        fn()


async def _safely_async(awaitable: Any) -> None:
    # Cleanup must never mask the test result.
    with contextlib.suppress(Exception):
        await awaitable
