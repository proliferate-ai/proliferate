"""Unit tests for cloud repos service boundary.

Verifies that the repos service uses the integration adapter correctly
and owns cloud-specific access checks without leaking raw GitHub behavior.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from proliferate.integrations.github import (
    GitHubIntegrationError,
    GitHubRepositoryPage,
    GitHubRepositorySummary,
    GitHubRepoBranches,
    GitHubRepoAccessRequired,
    GitHubRateLimited,
    list_branches,
)
from proliferate.db.store.cloud_repo_config import CloudRepoConfigSummaryValue
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repos.domain.github_credentials import (
    CloudRepoGitHubCredentials,
)
from proliferate.server.cloud.repos.service import (
    _require_github_access_token,
    build_cloud_repo_credentials_for_user,
    get_cloud_repo_branches,
    get_linked_github_account,
    list_cloud_repositories,
    get_repo_branches_for_credentials,
    get_repo_branches_for_user,
)


def _make_user(*, github_token: str | None = None):
    """Build a minimal User-like object with optional GitHub OAuth account."""

    class FakeOAuth:
        def __init__(self, oauth_name: str, access_token: str) -> None:
            self.oauth_name = oauth_name
            self.access_token = access_token

    class FakeUser:
        def __init__(self, oauth_accounts: list) -> None:
            self.id = uuid.uuid4()
            self.oauth_accounts = oauth_accounts

    accounts = []
    if github_token is not None:
        accounts.append(FakeOAuth("github", github_token))
    return FakeUser(accounts)


class TestGetLinkedGithubAccount:
    def test_returns_account_when_github_linked(self) -> None:
        user = _make_user(github_token="gh-token")
        account = get_linked_github_account(user)
        assert account is not None
        assert account.access_token == "gh-token"

    def test_returns_none_when_no_github_link(self) -> None:
        user = _make_user()
        assert get_linked_github_account(user) is None


class TestRequireGithubAccessToken:
    def test_returns_token_when_present(self) -> None:
        credentials = CloudRepoGitHubCredentials(
            user_id=uuid.uuid4(),
            access_token="gh-token",
        )
        assert _require_github_access_token(credentials, "msg") == "gh-token"

    def test_raises_cloud_error_when_missing(self) -> None:
        credentials = CloudRepoGitHubCredentials(
            user_id=uuid.uuid4(),
            access_token=None,
        )
        with pytest.raises(CloudApiError) as exc_info:
            _require_github_access_token(credentials, "connect first")
        assert exc_info.value.code == "github_link_required"
        assert exc_info.value.status_code == 400


class TestBuildCloudRepoCredentialsForUser:
    def test_returns_user_id_and_token(self) -> None:
        user = _make_user(github_token="gh-token")
        credentials = build_cloud_repo_credentials_for_user(user)
        assert credentials.user_id == user.id
        assert credentials.access_token == "gh-token"

    def test_returns_none_token_when_unlinked(self) -> None:
        user = _make_user()
        credentials = build_cloud_repo_credentials_for_user(user)
        assert credentials.user_id == user.id
        assert credentials.access_token is None


class TestGetRepoBranchesForUser:
    @pytest.mark.asyncio
    async def test_delegates_to_integration_adapter(self) -> None:
        user = _make_user(github_token="gh-token")
        branches = GitHubRepoBranches(default_branch="main", branches=["main", "dev"])

        with patch(
            "proliferate.server.cloud.repos.service.get_github_repo_branches",
            new_callable=AsyncMock,
            return_value=branches,
        ) as mock:
            result = await get_repo_branches_for_user(
                user,
                git_owner="acme",
                git_repo_name="rocket",
                missing_access_message="msg",
            )
            mock.assert_awaited_once_with("gh-token", "acme", "rocket")
            assert result is branches

    @pytest.mark.asyncio
    async def test_wraps_repo_access_error(self) -> None:
        user = _make_user(github_token="gh-token")

        with patch(
            "proliferate.server.cloud.repos.service.get_github_repo_branches",
            new_callable=AsyncMock,
            side_effect=GitHubRepoAccessRequired("no access"),
        ):
            with pytest.raises(CloudApiError) as exc_info:
                await get_repo_branches_for_user(
                    user,
                    git_owner="acme",
                    git_repo_name="rocket",
                    missing_access_message="msg",
                )
            assert exc_info.value.code == "github_repo_access_required"
            assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_wraps_repo_access_error_with_contextual_message(self) -> None:
        user = _make_user(github_token="gh-token")

        with patch(
            "proliferate.server.cloud.repos.service.get_github_repo_branches",
            new_callable=AsyncMock,
            side_effect=GitHubRepoAccessRequired("no access"),
        ):
            with pytest.raises(CloudApiError) as exc_info:
                await get_repo_branches_for_user(
                    user,
                    git_owner="acme",
                    git_repo_name="rocket",
                    missing_access_message="msg",
                    repo_access_required_message="custom repo access message",
                )
            assert exc_info.value.code == "github_repo_access_required"
            assert exc_info.value.status_code == 400
            assert exc_info.value.message == "custom repo access message"

    @pytest.mark.asyncio
    async def test_wraps_integration_error(self) -> None:
        user = _make_user(github_token="gh-token")

        with patch(
            "proliferate.server.cloud.repos.service.get_github_repo_branches",
            new_callable=AsyncMock,
            side_effect=GitHubIntegrationError("timeout"),
        ):
            with pytest.raises(CloudApiError) as exc_info:
                await get_repo_branches_for_user(
                    user,
                    git_owner="acme",
                    git_repo_name="rocket",
                    missing_access_message="msg",
                )
            assert exc_info.value.code == "github_branch_lookup_failed"
            assert exc_info.value.status_code == 502

    @pytest.mark.asyncio
    async def test_rejects_user_without_github_link(self) -> None:
        user = _make_user()

        with pytest.raises(CloudApiError) as exc_info:
            await get_repo_branches_for_user(
                user,
                git_owner="acme",
                git_repo_name="rocket",
                missing_access_message="connect first",
            )
        assert exc_info.value.code == "github_link_required"


class TestGetRepoBranchesForCredentials:
    @pytest.mark.asyncio
    async def test_delegates_to_integration_adapter(self) -> None:
        credentials = CloudRepoGitHubCredentials(
            user_id=uuid.uuid4(),
            access_token="gh-token",
        )
        branches = GitHubRepoBranches(default_branch="main", branches=["main", "dev"])

        with patch(
            "proliferate.server.cloud.repos.service.get_github_repo_branches",
            new_callable=AsyncMock,
            return_value=branches,
        ) as mock:
            result = await get_repo_branches_for_credentials(
                credentials,
                git_owner="acme",
                git_repo_name="rocket",
                missing_access_message="msg",
            )
            mock.assert_awaited_once_with("gh-token", "acme", "rocket")
            assert result is branches


class TestGetCloudRepoBranches:
    @pytest.mark.asyncio
    async def test_shapes_response_for_api(self) -> None:
        credentials = CloudRepoGitHubCredentials(
            user_id=uuid.uuid4(),
            access_token="gh-token",
        )
        branches = GitHubRepoBranches(
            default_branch="main",
            branches=["main", "release", "stable"],
        )

        with patch(
            "proliferate.server.cloud.repos.service.get_github_repo_branches",
            new_callable=AsyncMock,
            return_value=branches,
        ):
            result = await get_cloud_repo_branches(
                credentials,
                git_owner="acme",
                git_repo_name="rocket",
            )
            assert result.model_dump(by_alias=True) == {
                "defaultBranch": "main",
                "branches": ["main", "release", "stable"],
                "permission": None,
                "private": False,
                "fork": False,
                "archived": False,
                "disabled": False,
            }


class TestListCloudRepositories:
    @pytest.mark.asyncio
    async def test_maps_github_repositories_and_existing_config_state(self) -> None:
        credentials = CloudRepoGitHubCredentials(
            user_id=uuid.uuid4(),
            access_token="gh-token",
        )
        github_page = GitHubRepositoryPage(
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
            ],
            next_cursor="cursor-2",
        )
        configs = [
            CloudRepoConfigSummaryValue(
                id=uuid.uuid4(),
                owner_scope="personal",
                user_id=credentials.user_id,
                organization_id=None,
                git_owner="acme",
                git_repo_name="rocket",
                configured=True,
                configured_at=None,
                files_version=0,
            ),
            CloudRepoConfigSummaryValue(
                id=uuid.uuid4(),
                owner_scope="personal",
                user_id=credentials.user_id,
                organization_id=None,
                git_owner="acme",
                git_repo_name="disabled",
                configured=False,
                configured_at=None,
                files_version=0,
            ),
        ]

        with (
            patch(
                "proliferate.server.cloud.repos.service.list_github_repositories",
                new_callable=AsyncMock,
                return_value=github_page,
            ) as list_github,
            patch(
                "proliferate.server.cloud.repos.service.list_cloud_repo_configs",
                new_callable=AsyncMock,
                return_value=configs,
            ),
        ):
            result = await list_cloud_repositories(
                object(),  # type: ignore[arg-type]
                credentials,
                query=None,
                limit=25,
            )

        list_github.assert_awaited_once_with(
            "gh-token",
            cursor=None,
            limit=25,
            affiliation="owner,collaborator,organization_member",
            visibility="all",
        )
        assert result.next_cursor == "cursor-2"
        assert [repo.repo_config_state for repo in result.repositories] == [
            "configured",
            "disabled",
        ]
        assert result.repositories[0].configured is True
        assert result.repositories[1].configured is False

    @pytest.mark.asyncio
    async def test_maps_github_rate_limits(self) -> None:
        credentials = CloudRepoGitHubCredentials(
            user_id=uuid.uuid4(),
            access_token="gh-token",
        )
        with (
            patch(
                "proliferate.server.cloud.repos.service.list_github_repositories",
                new_callable=AsyncMock,
                side_effect=GitHubRateLimited("slow down", retry_after_seconds=30),
            ),
            pytest.raises(CloudApiError) as exc_info,
        ):
            await list_cloud_repositories(
                object(),  # type: ignore[arg-type]
                credentials,
            )
        assert exc_info.value.code == "github_rate_limited"
        assert exc_info.value.status_code == 429
        assert exc_info.value.extra_detail == {"retryAfterSeconds": 30}
        assert exc_info.value.headers == {"Retry-After": "30"}


class TestListBranchesAlias:
    def test_list_branches_is_same_function(self) -> None:
        from proliferate.integrations.github import get_github_repo_branches

        assert list_branches is get_github_repo_branches
