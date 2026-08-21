import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.worktree_policy import CloudWorktreeRetentionPolicy
from proliferate.integrations.github import (
    GitHubRateLimited,
    GitHubRepositoryPage,
    GitHubRepositorySummary,
    GitHubRepoBranches,
)
from proliferate.server.cloud.repos import service as repos_service
from tests.integration.cloud_api_helpers import (
    link_github_account,
    register_and_login,
    seed_desktop_worker,
    seed_github_app_repo_authority,
)


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
    async def test_repository_rate_limit_preserves_product_error_response(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _github_repositories(
            *_args: object,
            **_kwargs: object,
        ) -> GitHubRepositoryPage:
            raise GitHubRateLimited(
                "GitHub rate limit reached.",
                retry_after_seconds=30,
            )

        monkeypatch.setattr(
            repos_service,
            "list_github_repositories",
            _github_repositories,
        )

        session = await register_and_login(client, "cloud-repo-rate-limit@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await link_github_account(db_session, session["user_id"])
        await seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
            git_owner="acme",
        )

        response = await client.get("/v1/cloud/repos", headers=headers)

        assert response.status_code == 429
        assert response.json() == {
            "detail": {
                "code": "github_rate_limited",
                "message": "GitHub is rate limiting repository browsing. Try again later.",
                "retryAfterSeconds": 30,
            }
        }
        assert response.headers["retry-after"] == "30"

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


class TestLocalEnvironmentInstallOwnership:
    """PUT of a local environment must reject a desktop install the caller does not own."""

    @pytest.mark.asyncio
    async def test_put_local_environment_rejects_other_users_install(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        victim = await register_and_login(client, "install-ownership-victim@example.com")
        await seed_desktop_worker(
            db_session, user_id=victim["user_id"], desktop_install_id="install-victim"
        )
        attacker = await register_and_login(client, "install-ownership-attacker@example.com")
        headers = {"Authorization": f"Bearer {attacker['access_token']}"}

        response = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={
                "kind": "local",
                "gitProvider": "github",
                "desktopInstallId": "install-victim",
                "localPath": "/Users/tester/rocket",
                "defaultBranch": None,
                "setupScript": "",
                "runCommand": "",
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "desktop_install_not_owned"


class TestRepoEnvironmentArchivingKnobs:
    """PUT/GET round-trip for archive_script + rerun_setup_on_unarchive (R6)."""

    @pytest.mark.asyncio
    async def test_put_local_environment_echoes_archiving_knobs(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await register_and_login(client, "archiving-knobs-local@example.com")
        await seed_desktop_worker(
            db_session, user_id=session["user_id"], desktop_install_id="install-1"
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        response = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={
                "kind": "local",
                "gitProvider": "github",
                "desktopInstallId": "install-1",
                "localPath": "/Users/tester/rocket",
                "defaultBranch": None,
                "setupScript": "",
                "runCommand": "",
                "archiveScript": "scripts/archive.sh",
                "rerunSetupOnUnarchive": False,
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["archiveScript"] == "scripts/archive.sh"
        assert payload["rerunSetupOnUnarchive"] is False

    @pytest.mark.asyncio
    async def test_put_cloud_environment_echoes_archiving_knobs(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await register_and_login(client, "archiving-knobs-cloud@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await link_github_account(db_session, session["user_id"])
        await seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
            git_owner="acme",
        )

        response = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={
                "kind": "cloud",
                "gitProvider": "github",
                "defaultBranch": None,
                "setupScript": "",
                "runCommand": "",
                "archiveScript": "scripts/archive.sh",
                "rerunSetupOnUnarchive": False,
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["archiveScript"] == "scripts/archive.sh"
        assert payload["rerunSetupOnUnarchive"] is False

        listed = await client.get("/v1/cloud/repositories", headers=headers)
        assert listed.status_code == 200
        environments = listed.json()["repositories"][0]["environments"]
        assert environments[0]["archiveScript"] == "scripts/archive.sh"
        assert environments[0]["rerunSetupOnUnarchive"] is False

    @pytest.mark.asyncio
    async def test_first_put_omitting_knobs_uses_column_defaults(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await register_and_login(client, "archiving-knobs-defaults@example.com")
        await seed_desktop_worker(
            db_session, user_id=session["user_id"], desktop_install_id="install-1"
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        response = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={
                "kind": "local",
                "gitProvider": "github",
                "desktopInstallId": "install-1",
                "localPath": "/Users/tester/rocket",
                "defaultBranch": None,
                "setupScript": "",
                "runCommand": "",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["archiveScript"] == ""
        assert payload["rerunSetupOnUnarchive"] is True

    @pytest.mark.asyncio
    async def test_put_explicit_false_stores_false_not_swallowed_by_preserve_semantics(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await register_and_login(client, "archiving-knobs-explicit-false@example.com")
        await seed_desktop_worker(
            db_session, user_id=session["user_id"], desktop_install_id="install-1"
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        body = {
            "kind": "local",
            "gitProvider": "github",
            "desktopInstallId": "install-1",
            "localPath": "/Users/tester/rocket",
            "defaultBranch": None,
            "setupScript": "",
            "runCommand": "",
        }

        first = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={**body, "rerunSetupOnUnarchive": True},
        )
        assert first.status_code == 200
        assert first.json()["rerunSetupOnUnarchive"] is True

        second = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={**body, "rerunSetupOnUnarchive": False},
        )
        assert second.status_code == 200
        assert second.json()["rerunSetupOnUnarchive"] is False

    @pytest.mark.asyncio
    async def test_put_omitting_knobs_preserves_stored_values(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Negative control: revert the None-guard in _upsert_environment and this fails."""

        session = await register_and_login(client, "archiving-knobs-preserve@example.com")
        await seed_desktop_worker(
            db_session, user_id=session["user_id"], desktop_install_id="install-1"
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        first = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={
                "kind": "local",
                "gitProvider": "github",
                "desktopInstallId": "install-1",
                "localPath": "/Users/tester/rocket",
                "defaultBranch": None,
                "setupScript": "",
                "runCommand": "",
                "archiveScript": "scripts/archive.sh",
                "rerunSetupOnUnarchive": False,
            },
        )
        assert first.status_code == 200

        # A second PUT that omits both archiving knobs (as every real client
        # builder does today) must leave the stored values untouched.
        second = await client.put(
            "/v1/cloud/repositories/acme/rocket/environment",
            headers=headers,
            json={
                "kind": "local",
                "gitProvider": "github",
                "desktopInstallId": "install-1",
                "localPath": "/Users/tester/rocket",
                "defaultBranch": None,
                "setupScript": "pnpm install",
                "runCommand": "pnpm dev",
            },
        )

        assert second.status_code == 200
        payload = second.json()
        assert payload["setupScript"] == "pnpm install"
        assert payload["runCommand"] == "pnpm dev"
        assert payload["archiveScript"] == "scripts/archive.sh"
        assert payload["rerunSetupOnUnarchive"] is False
