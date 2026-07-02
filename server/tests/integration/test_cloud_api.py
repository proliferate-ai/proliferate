import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudOrganizationIntegrationPolicy
from proliferate.db.models.cloud.worktree_policy import CloudWorktreeRetentionPolicy
from proliferate.db.engine import apply_rls_context_to_session
from proliferate.integrations.github import (
    GitHubRepositoryPage,
    GitHubRepositorySummary,
    GitHubRepoBranches,
)
from proliferate.rls_context import with_rls_context
from proliferate.server.cloud.repos import service as repos_service
from tests.integration.cloud_api_helpers import (
    add_organization_member,
    create_organization_for_user,
    link_github_account,
    register_and_login,
    seed_github_app_repo_authority,
)


async def _insert_organization_integration_policy(
    db_session: AsyncSession,
    *,
    actor_user_id: str,
    organization_id: str,
    catalog_entry_id: str,
    enabled: bool,
) -> None:
    actor_uuid = uuid.UUID(actor_user_id)
    organization_uuid = uuid.UUID(organization_id)
    with with_rls_context(
        actor_user_id=actor_uuid,
        owner_scope="organization",
        organization_id=organization_uuid,
    ):
        await apply_rls_context_to_session(db_session)
        db_session.add(
            CloudOrganizationIntegrationPolicy(
                organization_id=organization_uuid,
                catalog_entry_id=catalog_entry_id,
                enabled=enabled,
                updated_by_user_id=actor_uuid,
            )
        )
        await db_session.commit()


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


async def _create_rls_test_role(db_session: AsyncSession, role_name: str) -> None:
    quoted_role = _quote_identifier(role_name)
    await db_session.execute(text(f"CREATE ROLE {quoted_role} NOLOGIN"))
    await db_session.execute(text(f"GRANT USAGE ON SCHEMA public TO {quoted_role}"))
    await db_session.execute(
        text(f"GRANT SELECT ON cloud_organization_integration_policy TO {quoted_role}")
    )
    await db_session.commit()


async def _drop_rls_test_role(db_session: AsyncSession, role_name: str) -> None:
    quoted_role = _quote_identifier(role_name)
    await db_session.rollback()
    await db_session.execute(text("RESET ROLE"))
    await db_session.execute(text(f"DROP OWNED BY {quoted_role}"))
    await db_session.execute(text(f"DROP ROLE IF EXISTS {quoted_role}"))
    await db_session.commit()


async def _list_integration_policy_as_role(
    db_session: AsyncSession,
    *,
    role_name: str,
) -> list[tuple[uuid.UUID, str]]:
    quoted_role = _quote_identifier(role_name)
    await db_session.rollback()
    await db_session.execute(text(f"SET LOCAL ROLE {quoted_role}"))
    rows = (
        await db_session.execute(
            select(
                CloudOrganizationIntegrationPolicy.organization_id,
                CloudOrganizationIntegrationPolicy.catalog_entry_id,
            ).order_by(CloudOrganizationIntegrationPolicy.catalog_entry_id)
        )
    ).all()
    await db_session.rollback()
    return [(row.organization_id, row.catalog_entry_id) for row in rows]


def _patch_repo_branches_lookup(
    monkeypatch: pytest.MonkeyPatch,
    resolver,
) -> None:
    monkeypatch.setattr(repos_service, "get_github_repo_branches", resolver)


class TestCloudWorktreeRetentionPolicy:
    @pytest.mark.asyncio
    async def test_default_policy_does_not_create_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        tokens = await register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        first = await client.get("/v1/cloud/worktree-retention-policy", headers=headers)
        second = await client.get("/v1/cloud/worktree-retention-policy", headers=headers)

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json() == {
            "maxMaterializedWorktreesPerRepo": 20,
            "updatedAt": "1970-01-01T00:00:00+00:00",
            "source": "default",
        }
        assert second.json() == first.json()
        rows = (
            (
                await db_session.execute(
                    select(CloudWorktreeRetentionPolicy).where(
                        CloudWorktreeRetentionPolicy.user_id == uuid.UUID(tokens["user_id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

    @pytest.mark.asyncio
    async def test_put_persists_policy(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        tokens = await register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        response = await client.put(
            "/v1/cloud/worktree-retention-policy",
            headers=headers,
            json={"maxMaterializedWorktreesPerRepo": 50},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["maxMaterializedWorktreesPerRepo"] == 50
        assert payload["source"] == "persisted"
        assert payload["updatedAt"] != "1970-01-01T00:00:00+00:00"
        row = (
            await db_session.execute(
                select(CloudWorktreeRetentionPolicy).where(
                    CloudWorktreeRetentionPolicy.user_id == uuid.UUID(tokens["user_id"])
                )
            )
        ).scalar_one()
        assert row.max_materialized_worktrees_per_repo == 50

    @pytest.mark.asyncio
    async def test_put_rejects_out_of_range_policy(
        self,
        client: AsyncClient,
    ) -> None:
        tokens = await register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
        response = await client.put(
            "/v1/cloud/worktree-retention-policy",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
            json={"maxMaterializedWorktreesPerRepo": 9},
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_worktree_retention_policy"


class TestCloudOrganizationIntegrationPolicy:
    @pytest.mark.asyncio
    async def test_owner_can_patch_policy_and_member_can_read_only(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        owner = await register_and_login(
            client,
            f"integration-policy-owner-{uuid.uuid4().hex[:8]}@example.com",
        )
        member = await register_and_login(
            client,
            f"integration-policy-member-{uuid.uuid4().hex[:8]}@example.com",
        )
        organization_id = await create_organization_for_user(db_session, owner["user_id"])
        await add_organization_member(
            db_session,
            organization_id=organization_id,
            user_id=member["user_id"],
        )
        owner_headers = {"Authorization": f"Bearer {owner['access_token']}"}
        member_headers = {"Authorization": f"Bearer {member['access_token']}"}
        url = f"/v1/cloud/organizations/{organization_id}/integration-policy"

        defaults = await client.get(url, headers=owner_headers)

        assert defaults.status_code == 200
        default_entries = {entry["catalogEntryId"]: entry for entry in defaults.json()["entries"]}
        assert default_entries["linear"]["enabled"] is True
        assert default_entries["linear"]["updatedAt"] is None

        patched = await client.patch(
            url,
            headers=owner_headers,
            json={"catalogEntryId": "linear", "enabled": False},
        )

        assert patched.status_code == 200
        patched_entries = {entry["catalogEntryId"]: entry for entry in patched.json()["entries"]}
        assert patched_entries["linear"]["enabled"] is False
        assert patched_entries["linear"]["updatedAt"] is not None
        assert patched_entries["linear"]["updatedByUserId"] == owner["user_id"]

        member_read = await client.get(url, headers=member_headers)
        member_write = await client.patch(
            url,
            headers=member_headers,
            json={"catalogEntryId": "linear", "enabled": True},
        )

        assert member_read.status_code == 200
        member_entries = {
            entry["catalogEntryId"]: entry for entry in member_read.json()["entries"]
        }
        assert member_entries["linear"]["enabled"] is False
        assert member_write.status_code == 403
        assert member_write.json()["detail"]["code"] == "organization_permission_denied"

    @pytest.mark.asyncio
    async def test_patch_rejects_unknown_catalog_entry(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        owner = await register_and_login(
            client,
            f"integration-policy-missing-{uuid.uuid4().hex[:8]}@example.com",
        )
        organization_id = await create_organization_for_user(db_session, owner["user_id"])

        response = await client.patch(
            f"/v1/cloud/organizations/{organization_id}/integration-policy",
            headers={"Authorization": f"Bearer {owner['access_token']}"},
            json={"catalogEntryId": "not-real", "enabled": False},
        )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "catalog_entry_not_found"

    @pytest.mark.asyncio
    async def test_rls_filters_policy_rows_without_org_filter(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        owner_a = await register_and_login(
            client,
            f"integration-policy-rls-a-{uuid.uuid4().hex[:8]}@example.com",
        )
        owner_b = await register_and_login(
            client,
            f"integration-policy-rls-b-{uuid.uuid4().hex[:8]}@example.com",
        )
        organization_a = await create_organization_for_user(db_session, owner_a["user_id"])
        organization_b = await create_organization_for_user(db_session, owner_b["user_id"])
        await _insert_organization_integration_policy(
            db_session,
            actor_user_id=owner_a["user_id"],
            organization_id=organization_a,
            catalog_entry_id="linear",
            enabled=False,
        )
        await _insert_organization_integration_policy(
            db_session,
            actor_user_id=owner_b["user_id"],
            organization_id=organization_b,
            catalog_entry_id="github",
            enabled=True,
        )

        role_name = f"rls_policy_{uuid.uuid4().hex}"
        await _create_rls_test_role(db_session, role_name)
        try:
            unscoped_rows = await _list_integration_policy_as_role(
                db_session,
                role_name=role_name,
            )
            assert unscoped_rows == []

            with with_rls_context(
                actor_user_id=uuid.UUID(owner_a["user_id"]),
                owner_scope="organization",
                organization_id=uuid.UUID(organization_a),
            ):
                scoped_rows = await _list_integration_policy_as_role(
                    db_session,
                    role_name=role_name,
                )
        finally:
            await _drop_rls_test_role(db_session, role_name)

        assert scoped_rows == [(uuid.UUID(organization_a), "linear")]


class TestCloudRepoBranches:
    @pytest.mark.asyncio
    async def test_branch_endpoint_returns_default_branch_and_list(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release", "stable"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await register_and_login(client, "cloud-branches@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await link_github_account(db_session, session["user_id"])
        # /v1/cloud/repos/* requires GitHub App authorization since the #809
        # cutover (ensure_fresh_github_app_authorization).
        await seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
            git_owner="acme",
        )

        response = await client.get(
            "/v1/cloud/repos/acme/rocket/branches",
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == {
            "defaultBranch": "main",
            "branches": ["main", "release", "stable"],
            "permission": None,
            "private": False,
            "fork": False,
            "archived": False,
            "disabled": False,
        }


class TestCloudRepoCatalog:
    @pytest.mark.asyncio
    async def test_list_cloud_repositories_marks_repo_config_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
                permission="push",
                private=True,
            )

        async def _github_repositories(*_args, **_kwargs) -> GitHubRepositoryPage:
            return GitHubRepositoryPage(
                repositories=[
                    GitHubRepositorySummary(
                        owner="acme",
                        name="rocket",
                        full_name="acme/rocket",
                        default_branch="main",
                        private=True,
                        fork=False,
                        archived=False,
                        disabled=False,
                        html_url="https://github.com/acme/rocket",
                        owner_avatar_url=None,
                        pushed_at="2026-05-01T00:00:00Z",
                        updated_at="2026-05-02T00:00:00Z",
                        permission="push",
                    ),
                    GitHubRepositorySummary(
                        owner="acme",
                        name="disabled",
                        full_name="acme/disabled",
                        default_branch="main",
                        private=False,
                        fork=False,
                        archived=False,
                        disabled=False,
                        html_url=None,
                        owner_avatar_url=None,
                        pushed_at=None,
                        updated_at=None,
                        permission="admin",
                    ),
                    GitHubRepositorySummary(
                        owner="acme",
                        name="missing",
                        full_name="acme/missing",
                        default_branch="main",
                        private=False,
                        fork=False,
                        archived=False,
                        disabled=False,
                        html_url=None,
                        owner_avatar_url=None,
                        pushed_at=None,
                        updated_at=None,
                        permission="pull",
                    ),
                ],
                next_cursor="cursor-2",
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)
        monkeypatch.setattr(
            repos_service,
            "list_github_repositories",
            _github_repositories,
        )

        session = await register_and_login(client, "cloud-repo-catalog@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await link_github_account(db_session, session["user_id"])
        await seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
            git_owner="acme",
        )
        configured = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={
                "kind": "cloud",
                "gitProvider": "github",
                "defaultBranch": None,
                "setupScript": "",
                "runCommand": "",
            },
        )
        assert configured.status_code == 200

        response = await client.get(
            "/v1/cloud/repos",
            headers=headers,
            params={"limit": 25},
        )

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store, private"
        assert response.headers["vary"] == "Authorization, Cookie"
        payload = response.json()
        assert payload["nextCursor"] == "cursor-2"
        assert [
            (repo["fullName"], repo["repoConfigState"], repo["configured"])
            for repo in payload["repositories"]
        ] == [
            ("acme/rocket", "configured", True),
            ("acme/disabled", "missing", False),
            ("acme/missing", "missing", False),
        ]
