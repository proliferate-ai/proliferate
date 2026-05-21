from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


async def _create_enrolled_target(
    client: AsyncClient,
    headers: dict[str, str],
) -> tuple[str, dict[str, str]]:
    create = await client.post(
        "/v1/cloud/targets/enrollments",
        headers=headers,
        json={
            "displayName": "Target Config SSH",
            "kind": "ssh",
            "ownerScope": "personal",
            "defaultWorkspaceRoot": "~/proliferate-workspaces",
        },
    )
    assert create.status_code == 200
    enrollment = create.json()
    enrolled = await client.post(
        "/v1/cloud/worker/enroll",
        json={
            "enrollmentToken": enrollment["enrollmentToken"],
            "machineFingerprint": f"target-config-{uuid.uuid4()}",
            "hostname": "target-config-worker",
            "workerVersion": "0.1.0",
        },
    )
    assert enrolled.status_code == 200
    return enrollment["target"]["id"], {
        "Authorization": f"Bearer {enrolled.json()['workerToken']}"
    }


@pytest.mark.asyncio
async def test_target_config_materialization_command_is_secret_safe(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="target-config",
    )
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token="gh-secret-token",
        account_email="target-config@example.com",
    )
    target_id, worker_headers = await _create_enrolled_target(client, auth.headers)

    repo_config = await client.put(
        "/v1/cloud/repos/proliferate-ai/proliferate/config",
        headers=auth.headers,
        json={
            "configured": True,
            "defaultBranch": None,
            "envVars": {"APP_SECRET": "repo-secret"},
            "setupScript": "pnpm install",
            "runCommand": "pnpm test",
            "files": [{"relativePath": ".env.local", "content": "TOKEN=file-secret\n"}],
        },
    )
    assert repo_config.status_code == 200
    credential = await client.put(
        "/v1/cloud/credentials/claude",
        headers=auth.headers,
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "anthropic-secret"},
        },
    )
    assert credential.status_code == 200

    created = await client.post(
        f"/v1/cloud/targets/{target_id}/configs/materialize",
        headers=auth.headers,
        json={
            "gitOwner": "proliferate-ai",
            "gitRepoName": "proliferate",
        },
    )
    assert created.status_code == 200
    payload = created.json()
    target_config = payload["targetConfig"]
    assert target_config["summary"]["envVarCount"] == 1
    assert target_config["summary"]["trackedFileCount"] == 1
    assert target_config["summary"]["hasGitCredential"] is True
    assert target_config["summary"]["agentCredentialProviders"] == ["claude"]
    assert payload["command"]["kind"] == "materialize_environment"

    lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["materialize_environment"], "leaseTimeoutSeconds": 30},
    )
    assert lease.status_code == 200
    command = lease.json()["command"]
    assert command["kind"] == "materialize_environment"
    assert command["payload"] == {
        "targetConfigId": target_config["id"],
        "configVersion": target_config["configVersion"],
    }
    assert "repo-secret" not in str(command)
    assert "gh-secret-token" not in str(command)
    assert "anthropic-secret" not in str(command)

    materialization = await client.get(
        f"/v1/cloud/worker/target-configs/{target_config['id']}/materialization",
        headers=worker_headers,
        params={
            "command_id": command["commandId"],
            "config_version": command["payload"]["configVersion"],
            "lease_id": command["leaseId"],
        },
    )
    assert materialization.status_code == 200
    plan = materialization.json()
    assert plan["envVars"]["APP_SECRET"] == "repo-secret"
    assert plan["trackedFiles"][0]["content"] == "TOKEN=file-secret\n"
    assert plan["gitCredential"]["accessToken"] == "gh-secret-token"
    assert plan["agentCredentials"]["claude"]["envVars"]["ANTHROPIC_API_KEY"] == (
        "anthropic-secret"
    )

    status = await client.post(
        f"/v1/cloud/worker/target-configs/{target_config['id']}/status",
        headers=worker_headers,
        json={
            "status": "applied",
            "commandId": command["commandId"],
            "configVersion": command["payload"]["configVersion"],
            "leaseId": command["leaseId"],
        },
    )
    assert status.status_code == 200
    assert status.json()["status"] == "applied"

    fetched = await client.get(
        f"/v1/cloud/targets/{target_id}/configs/{target_config['id']}",
        headers=auth.headers,
    )
    assert fetched.status_code == 200
    assert fetched.json()["materializationStatus"] == "applied"
    assert "repo-secret" not in str(fetched.json())

    refreshed = await client.post(
        f"/v1/cloud/targets/{target_id}/configs/materialize",
        headers=auth.headers,
        json={
            "gitOwner": "proliferate-ai",
            "gitRepoName": "proliferate",
        },
    )
    assert refreshed.status_code == 200
    refreshed_config = refreshed.json()["targetConfig"]
    assert refreshed_config["id"] == target_config["id"]
    assert refreshed_config["configVersion"] == target_config["configVersion"] + 1

    stale_plan = await client.get(
        f"/v1/cloud/worker/target-configs/{target_config['id']}/materialization",
        headers=worker_headers,
        params={
            "command_id": command["commandId"],
            "config_version": command["payload"]["configVersion"],
            "lease_id": command["leaseId"],
        },
    )
    assert stale_plan.status_code == 404

    stale_status = await client.post(
        f"/v1/cloud/worker/target-configs/{target_config['id']}/status",
        headers=worker_headers,
        json={
            "status": "applied",
            "commandId": command["commandId"],
            "configVersion": command["payload"]["configVersion"],
            "leaseId": command["leaseId"],
        },
    )
    assert stale_status.status_code == 404


@pytest.mark.asyncio
async def test_target_git_identity_materialization_command_is_secret_safe(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="target-git-identity",
    )
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token="gh-target-secret-token",
        account_email="target-git@example.com",
    )
    target_id, worker_headers = await _create_enrolled_target(client, auth.headers)

    lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["configure_git_identity"], "leaseTimeoutSeconds": 300},
    )
    assert lease.status_code == 200
    command = lease.json()["command"]
    assert command["kind"] == "configure_git_identity"
    assert command["targetId"] == target_id
    assert set(command["payload"]) == {"targetGitIdentityId", "configVersion"}
    assert "gh-target-secret-token" not in str(command)

    materialization = await client.get(
        "/v1/cloud/worker/target-git-identities/"
        f"{command['payload']['targetGitIdentityId']}/materialization",
        headers=worker_headers,
        params={
            "command_id": command["commandId"],
            "config_version": command["payload"]["configVersion"],
            "lease_id": command["leaseId"],
        },
    )
    assert materialization.status_code == 200
    plan = materialization.json()
    assert plan["accessToken"] == "gh-target-secret-token"
    assert plan["email"] == "target-git@example.com"

    status = await client.post(
        "/v1/cloud/worker/target-git-identities/"
        f"{command['payload']['targetGitIdentityId']}/status",
        headers=worker_headers,
        json={
            "status": "applied",
            "commandId": command["commandId"],
            "configVersion": command["payload"]["configVersion"],
            "leaseId": command["leaseId"],
        },
    )
    assert status.status_code == 200
    assert status.json()["status"] == "applied"
