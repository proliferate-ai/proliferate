from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from tests.e2e.cloud.helpers.auth import create_user_and_login


class TestCloudTargetsApi:
    @pytest.mark.asyncio
    async def test_ssh_target_enrollment_and_worker_inventory(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-targets",
        )

        create = await client.post(
            "/v1/cloud/targets/enrollments",
            headers=auth.headers,
            json={
                "displayName": "Staging SSH Box",
                "kind": "ssh",
                "ownerScope": "personal",
                "defaultWorkspaceRoot": "~/proliferate-workspaces",
            },
        )
        assert create.status_code == 200
        enrollment = create.json()
        target_id = enrollment["target"]["id"]
        assert enrollment["target"]["status"] == "enrolling"
        assert "PROLIFERATE_ENROLLMENT_TOKEN" in enrollment["installCommand"]

        worker_enroll = await client.post(
            "/v1/cloud/worker/enroll",
            json={
                "enrollmentToken": enrollment["enrollmentToken"],
                "machineFingerprint": "test-machine",
                "hostname": "staging-ssh",
                "workerVersion": "0.1.0",
                "inventory": {
                    "os": "linux",
                    "arch": "x86_64",
                    "git": {"available": True, "version": "git version 2.44.0"},
                    "node": {"node": {"available": True, "version": "v22.0.0"}},
                    "python": {"python3": {"available": True, "version": "Python 3.12"}},
                },
            },
        )
        assert worker_enroll.status_code == 200
        worker = worker_enroll.json()
        assert worker["targetId"] == target_id
        worker_headers = {"Authorization": f"Bearer {worker['workerToken']}"}

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers=worker_headers,
            json={"status": "online", "statusDetail": "ready"},
        )
        assert heartbeat.status_code == 200

        inventory = await client.post(
            "/v1/cloud/worker/inventory",
            headers=worker_headers,
            json={
                "status": "online",
                "os": "linux",
                "arch": "x86_64",
                "git": {"available": True, "version": "git version 2.45.0"},
                "node": {"node": {"available": True, "version": "v22.1.0"}},
                "python": {"python3": {"available": True, "version": "Python 3.12"}},
                "capabilities": {"processSpawn": True, "filesystem": True},
                "raw": {"secret": "do-not-expose"},
            },
        )
        assert inventory.status_code == 200

        detail = await client.get(f"/v1/cloud/targets/{target_id}", headers=auth.headers)
        assert detail.status_code == 200
        payload = detail.json()
        assert payload["status"] == "online"
        assert payload["inventory"]["git"]["version"] == "git version 2.45.0"
        assert "raw" not in payload["inventory"]

        listed = await client.get("/v1/cloud/targets", headers=auth.headers)
        assert listed.status_code == 200
        assert [target["id"] for target in listed.json()] == [target_id]

        archived = await client.post(
            f"/v1/cloud/targets/{target_id}/archive",
            headers=auth.headers,
        )
        assert archived.status_code == 200
        assert archived.json()["target"]["status"] == "archived"

        stale_heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers=worker_headers,
            json={"status": "online"},
        )
        assert stale_heartbeat.status_code == 401
        assert stale_heartbeat.json()["detail"]["code"] == "cloud_worker_archived"

    @pytest.mark.asyncio
    async def test_org_member_can_view_but_not_archive_target(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        owner = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-target-owner",
        )
        member = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-target-member",
        )
        organization = Organization(name="Cloud Target Org")
        db_session.add(organization)
        await db_session.flush()
        db_session.add_all(
            [
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=uuid.UUID(owner.user_id),
                    role=ORGANIZATION_ROLE_OWNER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                ),
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=uuid.UUID(member.user_id),
                    role=ORGANIZATION_ROLE_MEMBER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                ),
            ]
        )
        await db_session.commit()

        create = await client.post(
            "/v1/cloud/targets/enrollments",
            headers=owner.headers,
            json={
                "displayName": "Team SSH Box",
                "kind": "ssh",
                "ownerScope": "organization",
                "organizationId": str(organization.id),
            },
        )
        assert create.status_code == 200
        target_id = create.json()["target"]["id"]

        detail = await client.get(f"/v1/cloud/targets/{target_id}", headers=member.headers)
        assert detail.status_code == 200

        denied = await client.post(
            f"/v1/cloud/targets/{target_id}/archive",
            headers=member.headers,
        )
        assert denied.status_code == 403
        assert denied.json()["detail"]["code"] == "cloud_target_organization_permission_denied"

        archived = await client.post(
            f"/v1/cloud/targets/{target_id}/archive",
            headers=owner.headers,
        )
        assert archived.status_code == 200
        assert archived.json()["target"]["status"] == "archived"
