from datetime import UTC, datetime, timedelta
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.cloud.mcp import (
    CloudMcpConnection,
    CloudMcpConnectionAuth,
)
from proliferate.db.models.cloud.integrations import CloudOrganizationIntegrationPolicy
from proliferate.db.models.cloud.worktree_policy import CloudWorktreeRetentionPolicy
from proliferate.db.engine import apply_rls_context_to_session
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import github_app as github_app_store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.github import (
    GitHubAppInstallationInfo,
    GitHubRepositoryPage,
    GitHubRepositorySummary,
    GitHubRepoBranches,
)
from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
from proliferate.rls_context import with_rls_context
from proliferate.server.cloud.github_app import repo_authority
from proliferate.server.cloud.repos import service as repos_service
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _billing_subject_for_user(db_session: AsyncSession, user_id: uuid.UUID):
    return await ensure_personal_billing_subject(db_session, user_id)


async def _register_and_login(
    client: AsyncClient,
    email: str,
    *,
    link_github: bool = True,
) -> dict[str, str]:
    """Create a user via the user manager and obtain tokens via PKCE."""
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.auth.users import get_user_db

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(email=email, password="unused-oauth-only", display_name="Cloud Tester"),
            )
            if link_github:
                session.add(
                    OAuthAccount(
                        user_id=user.id,
                        oauth_name="github",
                        access_token="github-access-token",
                        account_id=f"github-{user.id}",
                        account_email=email,
                    )
                )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="cloud-state",
    )
    return {
        "user_id": user_id,
        "access_token": str(token_data["access_token"]),
    }


async def _link_github_account(db_session: AsyncSession, user_id: str) -> None:
    existing = (
        await db_session.execute(
            select(OAuthAccount).where(
                OAuthAccount.user_id == uuid.UUID(user_id),
                OAuthAccount.oauth_name == "github",
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.access_token = "github-access-token"
        existing.account_id = "12345"
        existing.account_email = "cloud@example.com"
        await db_session.commit()
        return

    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="github",
        access_token="github-access-token",
        account_id="12345",
        account_email="cloud@example.com",
    )
    db_session.add(account)
    await db_session.commit()


async def _seed_github_app_repo_authority(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    user_id: str,
    git_owner: str = "proliferate-ai",
) -> None:
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=uuid.UUID(user_id),
        authorization=GitHubAppUserAuthorization(
            access_token="github-app-user-token",
            refresh_token="github-app-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=8),
            refresh_token_expires_at=datetime.now(UTC) + timedelta(days=180),
            github_user_id="12345",
            github_login="cloud-tester",
            permissions={},
        ),
    )
    await github_app_store.upsert_github_app_installation(
        db_session,
        installation=GitHubAppInstallationInfo(
            github_installation_id="142900805",
            account_login=git_owner,
            account_type="Organization",
            repository_selection="all",
            permissions={"contents": "read", "pull_requests": "write"},
            suspended_at=None,
        ),
    )
    await db_session.commit()

    async def _has_access(**_kwargs) -> bool:  # type: ignore[no-untyped-def]
        return True

    monkeypatch.setattr(repo_authority, "verify_github_app_user_repo_access", _has_access)


async def _link_secondary_account(db_session: AsyncSession, user_id: str) -> None:
    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="google",
        access_token="google-access-token",
        account_id="secondary-12345",
        account_email="cloud-secondary@example.com",
    )
    db_session.add(account)
    await db_session.commit()


async def _create_organization_for_user(db_session: AsyncSession, user_id: str) -> str:
    now = datetime.now(UTC)
    organization = Organization(
        name="Cloud Test Team",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=uuid.UUID(user_id),
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
    return str(organization.id)


async def _add_organization_member(
    db_session: AsyncSession,
    *,
    organization_id: str,
    user_id: str,
    role: str = ORGANIZATION_ROLE_MEMBER,
) -> None:
    now = datetime.now(UTC)
    db_session.add(
        OrganizationMembership(
            organization_id=uuid.UUID(organization_id),
            user_id=uuid.UUID(user_id),
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()


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


async def _list_mcp_connections(
    db_session: AsyncSession,
    user_id: str,
) -> list[CloudMcpConnection]:
    return (
        (
            await db_session.execute(
                select(CloudMcpConnection).where(
                    CloudMcpConnection.owner_user_id == uuid.UUID(user_id)
                )
            )
        )
        .scalars()
        .all()
    )


async def _list_mcp_connection_auths(
    db_session: AsyncSession,
) -> list[CloudMcpConnectionAuth]:
    return (await db_session.execute(select(CloudMcpConnectionAuth))).scalars().all()


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
        tokens = await _register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
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
        tokens = await _register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
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
        tokens = await _register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
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
        owner = await _register_and_login(
            client,
            f"integration-policy-owner-{uuid.uuid4().hex[:8]}@example.com",
        )
        member = await _register_and_login(
            client,
            f"integration-policy-member-{uuid.uuid4().hex[:8]}@example.com",
        )
        organization_id = await _create_organization_for_user(db_session, owner["user_id"])
        await _add_organization_member(
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
        owner = await _register_and_login(
            client,
            f"integration-policy-missing-{uuid.uuid4().hex[:8]}@example.com",
        )
        organization_id = await _create_organization_for_user(db_session, owner["user_id"])

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
        owner_a = await _register_and_login(
            client,
            f"integration-policy-rls-a-{uuid.uuid4().hex[:8]}@example.com",
        )
        owner_b = await _register_and_login(
            client,
            f"integration-policy-rls-b-{uuid.uuid4().hex[:8]}@example.com",
        )
        organization_a = await _create_organization_for_user(db_session, owner_a["user_id"])
        organization_b = await _create_organization_for_user(db_session, owner_b["user_id"])
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

        session = await _register_and_login(client, "cloud-branches@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        # /v1/cloud/repos/* requires GitHub App authorization since the #809
        # cutover (ensure_fresh_github_app_authorization).
        await _seed_github_app_repo_authority(
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

        session = await _register_and_login(client, "cloud-repo-catalog@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _seed_github_app_repo_authority(
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
