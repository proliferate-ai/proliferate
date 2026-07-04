"""Unit tests for cloud sandbox materialization."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.server.cloud.materialization.materialize import sandbox

USER_ID = uuid.uuid4()
NOW = datetime(2026, 7, 4, tzinfo=UTC)


def _repo_environment(
    *,
    id: uuid.UUID | None = None,
    user_id: uuid.UUID = USER_ID,
    git_owner: str = "test-org",
    git_repo_name: str = "test-repo",
) -> RepoEnvironmentValue:
    return RepoEnvironmentValue(
        id=id or uuid.uuid4(),
        user_id=user_id,
        environment_kind="cloud",
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        default_branch=None,
        created_at=NOW,
        updated_at=NOW,
    )


def _ctx() -> Any:
    return SimpleNamespace(
        sandbox=SimpleNamespace(id=uuid.uuid4()),
        target=object(),
    )


class TestMaterializeSandboxWithRepoEnvironments:
    @pytest.mark.asyncio
    async def test_calls_repo_environment_materializer_with_correct_signature(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Regression test for TypeError when calling materialize_repo_environment_in_context.

        The bug was that sandbox.py called materialize_repo_environment_in_context with
        (db, ctx=ctx, repo_environment=repo_environment) but the real signature requires
        (db, ctx=ctx, repo_environment_id=..., materialization_id=..., attempt_updated_at=...).
        """
        repo_env = _repo_environment()
        materialization_id = uuid.uuid4()

        # Track what arguments were passed to the function
        materialization_calls: list[dict[str, Any]] = []

        async def mock_materialize_in_context(
            db: Any,
            *,
            ctx: Any,
            repo_environment_id: uuid.UUID,
            materialization_id: uuid.UUID,
            attempt_updated_at: datetime,
        ) -> None:
            materialization_calls.append({
                "db": db,
                "ctx": ctx,
                "repo_environment_id": repo_environment_id,
                "materialization_id": materialization_id,
                "attempt_updated_at": attempt_updated_at,
            })

        # Mock dependencies
        async def mock_materialize_github_creds(*args: Any, **kwargs: Any) -> None:
            pass

        async def mock_materialize_secrets(*args: Any, **kwargs: Any) -> None:
            pass

        async def mock_materialize_agent_auth(*args: Any, **kwargs: Any) -> None:
            pass

        async def mock_list_repo_environments(db: Any, *, user_id: uuid.UUID) -> list[RepoEnvironmentValue]:
            return [repo_env]

        async def mock_begin_materialization(
            db: Any,
            *,
            cloud_sandbox_id: uuid.UUID,
            repo_environment_id: uuid.UUID,
        ) -> Any:
            return SimpleNamespace(
                id=materialization_id,
                updated_at=NOW,
            )

        from proliferate.db.store import cloud_repo_environment_materializations as repo_mat_store
        from proliferate.db.store import repositories as repositories_store
        from proliferate.server.cloud.materialization.materialize import (
            agent_auth,
            github_credentials,
            repo_environment as repo_environment_materializer,
            secret_set,
        )

        monkeypatch.setattr(github_credentials, "materialize_github_credentials", mock_materialize_github_creds)
        monkeypatch.setattr(secret_set, "materialize_global_secrets_for_user", mock_materialize_secrets)
        monkeypatch.setattr(agent_auth, "materialize_agent_auth", mock_materialize_agent_auth)
        monkeypatch.setattr(repositories_store, "list_cloud_repo_environments", mock_list_repo_environments)
        monkeypatch.setattr(repo_mat_store, "begin_repo_environment_materialization", mock_begin_materialization)
        monkeypatch.setattr(
            repo_environment_materializer,
            "materialize_repo_environment_in_context",
            mock_materialize_in_context,
        )

        # Execute
        ctx = _ctx()
        await sandbox._materialize_sandbox(ctx, db=object(), user_id=USER_ID)

        # Verify that materialize_repo_environment_in_context was called with correct signature
        assert len(materialization_calls) == 1
        call = materialization_calls[0]
        assert call["repo_environment_id"] == repo_env.id
        assert call["materialization_id"] == materialization_id
        assert call["attempt_updated_at"] == NOW
        assert call["ctx"] == ctx

    @pytest.mark.asyncio
    async def test_handles_multiple_repo_environments(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test that all repo environments are materialized in order."""
        repo_env1 = _repo_environment(git_repo_name="repo1")
        repo_env2 = _repo_environment(git_repo_name="repo2")
        mat1_id = uuid.uuid4()
        mat2_id = uuid.uuid4()

        materialization_calls: list[uuid.UUID] = []

        async def mock_materialize_in_context(
            db: Any,
            *,
            ctx: Any,
            repo_environment_id: uuid.UUID,
            materialization_id: uuid.UUID,
            attempt_updated_at: datetime,
        ) -> None:
            materialization_calls.append(repo_environment_id)

        async def mock_materialize_github_creds(*args: Any, **kwargs: Any) -> None:
            pass

        async def mock_materialize_secrets(*args: Any, **kwargs: Any) -> None:
            pass

        async def mock_materialize_agent_auth(*args: Any, **kwargs: Any) -> None:
            pass

        async def mock_list_repo_environments(db: Any, *, user_id: uuid.UUID) -> list[RepoEnvironmentValue]:
            return [repo_env1, repo_env2]

        call_count = 0
        async def mock_begin_materialization(
            db: Any,
            *,
            cloud_sandbox_id: uuid.UUID,
            repo_environment_id: uuid.UUID,
        ) -> Any:
            nonlocal call_count
            call_count += 1
            mat_id = mat1_id if call_count == 1 else mat2_id
            return SimpleNamespace(
                id=mat_id,
                updated_at=NOW,
            )

        from proliferate.db.store import cloud_repo_environment_materializations as repo_mat_store
        from proliferate.db.store import repositories as repositories_store
        from proliferate.server.cloud.materialization.materialize import (
            agent_auth,
            github_credentials,
            repo_environment as repo_environment_materializer,
            secret_set,
        )

        monkeypatch.setattr(github_credentials, "materialize_github_credentials", mock_materialize_github_creds)
        monkeypatch.setattr(secret_set, "materialize_global_secrets_for_user", mock_materialize_secrets)
        monkeypatch.setattr(agent_auth, "materialize_agent_auth", mock_materialize_agent_auth)
        monkeypatch.setattr(repositories_store, "list_cloud_repo_environments", mock_list_repo_environments)
        monkeypatch.setattr(repo_mat_store, "begin_repo_environment_materialization", mock_begin_materialization)
        monkeypatch.setattr(
            repo_environment_materializer,
            "materialize_repo_environment_in_context",
            mock_materialize_in_context,
        )

        # Execute
        ctx = _ctx()
        await sandbox._materialize_sandbox(ctx, db=object(), user_id=USER_ID)

        # Verify both repo environments were materialized
        assert materialization_calls == [repo_env1.id, repo_env2.id]
