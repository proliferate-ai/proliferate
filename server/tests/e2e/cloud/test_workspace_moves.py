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

import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.integrations.anyharness.mobility import (
    export_runtime_mobility_archive,
    install_runtime_mobility_archive,
    set_runtime_mobility_state,
)
from proliferate.server.cloud.materialization import service as materialization_service
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.config import ensure_cloud_runtime_binary_ready
from tests.e2e.cloud.helpers.github import (
    seed_github_app_repo_authority,
    seed_linked_github_account,
)
from tests.e2e.cloud.helpers.local_runtime import (
    clone_repo_on_new_branch,
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
from tests.e2e.cloud.helpers.workspace_moves import (
    assert_export_guard_rejects_mismatch,
    get_move,
    local_ref,
    move_phase,
    put_repo_config,
    require_repo_config_id,
    sandbox_provider_id,
    sandbox_runtime_access,
    seed_sandbox_claude_api_key,
    seed_sandbox_codex_api_key,
    start_move,
    teardown,
)
from tests.e2e.cloud.helpers.workspaces import create_ready_cloud_workspace

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
        await seed_sandbox_claude_api_key(cloud_client, auth, cloud_test_config.anthropic_api_key)
        if include_codex:
            assert cloud_test_config.openai_api_key is not None
            await seed_sandbox_codex_api_key(cloud_client, auth, cloud_test_config.openai_api_key)
        # Configuring the cloud repo environment is what creates the repo_config
        # row on this branch (the standalone ``/repos/.../config`` endpoint the
        # earlier provisioning idiom used was removed by the Stack-1 cutover);
        # the move's logical identity is that same repo_config.
        await put_repo_config(
            cloud_client,
            auth,
            owner=owner,
            repo=repo,
            base_branch=cloud_test_config.github_base_branch,
        )
        repo_config_id = await require_repo_config_id(
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
        provider_sandbox_id = await sandbox_provider_id(db_session, user_uuid)

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
            assert turn_contains_text(teach, "STORED"), f"Local {kind} did not store the codeword."
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
        move1 = await start_move(
            cloud_client,
            auth,
            repo_config_id=repo_config_id,
            branch=branch,
            base_commit_sha=base_sha,
            source=local_ref(run_id, local_ws_id),
            destination={"kind": "cloud"},
            idempotency_key=f"{run_id}-local-to-cloud",
        )
        assert move1["phase"] == "destination_ready"
        move1_id = move1["id"]
        destination_workspace_id = str(move1["destinationRef"]["cloudWorkspaceId"])
        sandbox_ws_id = str(move1["destinationRef"]["anyharnessWorkspaceId"])

        # Freeze + export on the local runtime (requireCleanGitState + expected guards).
        await set_runtime_mobility_state(
            local_url,
            local_token,
            anyharness_workspace_id=local_ws_id,
            mode="frozen_for_handoff",
            handoff_op_id=move1_id,
        )
        await assert_export_guard_rejects_mismatch(
            local_url, local_token, local_ws_id, base_sha, branch
        )
        archive1 = await export_runtime_mobility_archive(
            local_url,
            local_token,
            anyharness_workspace_id=local_ws_id,
            expected_handoff_op_id=move1_id,
            expected_base_commit_sha=base_sha,
            expected_branch_name=branch,
        )

        install1 = await move_phase(
            cloud_client, auth, move1_id, "install", body={"archive": archive1}
        )
        assert install1["phase"] == "installed"
        cutover1 = await move_phase(cloud_client, auth, move1_id, "cutover")
        assert cutover1["phase"] == "cutover" and cutover1["canonicalSide"] == "destination"

        # Source fate: the local ws is a plain directory -> remote_owned only (files untouched).
        await set_runtime_mobility_state(
            local_url, local_token, anyharness_workspace_id=local_ws_id, mode="remote_owned"
        )
        complete1 = await move_phase(cloud_client, auth, move1_id, "complete")
        assert complete1["phase"] == "completed" and complete1["canonicalSide"] == "destination"

        # --- Use it there: the migrated session resumes natively in the sandbox ---
        _archive_native_ids = [
            (s.get("session", {}).get("id"), s.get("session", {}).get("nativeSessionId"))
            for s in (archive1.get("sessions") or [])
            if isinstance(s, dict)
        ]
        print(f"[E2E-DIAG] archive1 session native ids: {_archive_native_ids}", flush=True)
        sandbox_url, sandbox_token = await sandbox_runtime_access(db_session, user_uuid)
        for leg in legs:
            sandbox_session = await runtime_get_session(sandbox_url, sandbox_token, leg.session_id)
            print(
                f"[E2E-DIAG] sandbox {leg.kind} session keys={sorted(sandbox_session.keys())} "
                f"nativeSessionId={sandbox_session.get('nativeSessionId')!r} "
                f"expected={leg.native_session_id!r}",
                flush=True,
            )
            assert sandbox_session.get("nativeSessionId") == leg.native_session_id, (
                f"{leg.kind} session lost its native id crossing into the sandbox."
            )
            assert len(await runtime_list_events(sandbox_url, sandbox_token, leg.session_id)) > 0

            recall_cloud = await runtime_prompt_and_collect(
                sandbox_url,
                sandbox_token,
                leg.session_id,
                "What is the codeword I asked you to remember? Do not edit any files. "
                "Reply with exactly that word and nothing else.",
                timeout_seconds=_PROMPT_TIMEOUT_SECONDS,
            )
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
        move2 = await start_move(
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
            destination=local_ref(run_id, local_ws_id),
            idempotency_key=f"{run_id}-cloud-to-local",
        )
        assert move2["phase"] == "destination_ready"
        move2_id = move2["id"]

        export2 = await move_phase(cloud_client, auth, move2_id, "export")
        archive2 = export2["archive"]

        # Re-adopt the original local workspace (still remote_owned) in place.
        readopt = await install_runtime_mobility_archive(
            local_url,
            local_token,
            anyharness_workspace_id=local_ws_id,
            archive=archive2,
            operation_id=move2_id,
            install_mode="preserve_native_sessions",
        )
        for leg in legs:
            assert leg.session_id in readopt.imported_session_ids, (
                f"{leg.kind} session was not re-imported into the local workspace."
            )

        install2 = await move_phase(cloud_client, auth, move2_id, "install", body={})
        assert install2["phase"] == "installed"
        cutover2 = await move_phase(cloud_client, auth, move2_id, "cutover")
        assert cutover2["canonicalSide"] == "destination"
        complete2 = await move_phase(cloud_client, auth, move2_id, "complete")
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
                local_url,
                local_token,
                leg.session_id,
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
            row = await get_move(cloud_client, auth, move_id)
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
        await teardown(
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
