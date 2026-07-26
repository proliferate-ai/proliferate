from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers import (
    PROVIDER_CASES,
    assert_workspace_sane,
    create_ready_cloud_workspace,
    create_user_and_login,
    delete_cloud_workspace_quietly,
    get_cloud_connection,
    seed_github_app_authorization,
    seed_linked_github_account,
    workspace_status,
)


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_provisioned_workspace_is_sane(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
) -> None:
    # Seed the exact user prerequisites the product relies on: a linked GitHub
    # token that can access the test repo.
    assert cloud_test_config.github_token is not None

    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-provision",
    )
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=cloud_test_config.github_token,
    )
    # The repo-environment write path is gated on a ready GitHub App
    # authorization; seed the real callback outcome (ruled seam, never a
    # bypass) so the create flow below runs the same product code as prod.
    await seed_github_app_authorization(
        db_session,
        user_id=auth.user_id,
    )
    # The runtime smoke needs a launchable agent. Configure claude through the
    # product's own agent-auth APIs (vault key + cloud selection) so sandbox
    # bootstrap delivers the state file the runtime launcher reads.
    assert cloud_test_config.anthropic_api_key, (
        "ANTHROPIC_API_KEY is required for the runtime agent smoke."
    )
    key_response = await cloud_client.post(
        "/v1/cloud/agent-gateway/keys",
        headers=auth.headers,
        json={"title": "cloud-e2e anthropic", "value": cloud_test_config.anthropic_api_key},
    )
    assert key_response.status_code == 200, key_response.text
    selection_response = await cloud_client.put(
        "/v1/cloud/agent-gateway/selections/claude",
        headers=auth.headers,
        params={"surface": "cloud"},
        json={
            "sources": [
                {
                    "sourceKind": "api_key",
                    "enabled": True,
                    "apiKeyId": key_response.json()["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                }
            ]
        },
    )
    assert selection_response.status_code == 200, selection_response.text
    # Prove the selection renders to a deliverable state BEFORE provisioning:
    # an empty harness list here means the source was dropped server-side and
    # the sandbox would (correctly) fail closed at agent launch.
    state_response = await cloud_client.get(
        "/v1/cloud/agent-gateway/state",
        headers=auth.headers,
        params={"surface": "cloud"},
    )
    assert state_response.status_code == 200, state_response.text
    rendered_harnesses = state_response.json().get("harnesses", [])
    assert [h.get("harnessKind") or h.get("harness_kind") for h in rendered_harnesses] == [
        "claude"
    ], state_response.text
    # Create the workspace through the normal API, wait for the control plane to
    # finish provisioning, then fetch the runtime connection metadata.
    branch_name, workspace = await create_ready_cloud_workspace(
        cloud_client,
        auth,
        db_session,
        cloud_test_config,
        provider_kind=provider_kind,
        branch_prefix=f"cloud-sane-{provider_kind}",
    )
    # Deliver the agent-auth state into the now-live sandbox. In prod the App
    # callback schedules the full sandbox bootstrap (github_app/service.py) and
    # later selection writes schedule refreshes; the seeded-authorization seam
    # skips the callback, so run the same product refresh explicitly.
    from uuid import UUID as _UUID

    from proliferate.server.cloud.materialization.materialize.agent_auth import (
        materialize_agent_auth_for_user,
    )

    await materialize_agent_auth_for_user(db_session, user_id=_UUID(auth.user_id))

    connection = await get_cloud_connection(
        cloud_client,
        auth,
        str(workspace["id"]),
        db_session=db_session,
    )

    try:
        # First assert the control plane's view of the runtime connection, then
        # probe the runtime itself for git and one-message sanity.
        assert workspace_status(workspace) == "ready"
        assert connection["runtimeUrl"]
        assert connection["accessToken"]
        assert connection["anyharnessWorkspaceId"]
        # runtime_generation is a placeholder today: not a DB column, the
        # store constructs every row value with 0 (cloud_sandboxes.py). The
        # old >= 1 assertion described the deleted remote-access domain.
        assert connection["runtimeGeneration"] == 0
        assert connection["allowedAgentKinds"] == ["claude", "codex", "opencode", "grok"]
        # readyAgentKinds is serialized but never populated by the current
        # server (models.py default_factory=list; _workspace_payload does not
        # set it). The old == ["claude"] expectation belonged to the deleted
        # remote-access domain's readiness computation.
        assert connection["readyAgentKinds"] == []

        await assert_workspace_sane(
            connection,
            expected_branch=branch_name,
            agent_kind="claude",
        )
    finally:
        # Provisioning tests own their workspace lifecycle and always tear down
        # the sandbox, even when sanity assertions fail.
        await delete_cloud_workspace_quietly(
            cloud_client,
            auth,
            str(workspace["id"]),
            db_session=db_session,
        )
