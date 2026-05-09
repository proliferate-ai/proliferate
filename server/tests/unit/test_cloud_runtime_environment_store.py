from __future__ import annotations

from uuid import uuid4

import pytest

from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.store.cloud_runtime_environments import persist_runtime_environment_state


def _environment() -> CloudRuntimeEnvironment:
    user_id = uuid4()
    return CloudRuntimeEnvironment(
        id=uuid4(),
        user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        billing_subject_id=user_id,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_owner_norm="acme",
        git_repo_name_norm="rocket",
        isolation_policy="repo_shared",
        status="running",
        runtime_url="https://old.invalid",
        runtime_token_ciphertext="old-token",
        runtime_generation=7,
        credential_snapshot_version=0,
        repo_env_applied_version=0,
    )


@pytest.mark.asyncio
async def test_runtime_url_rotation_does_not_increment_generation(db_session) -> None:
    environment = _environment()
    db_session.add(environment)
    await db_session.flush()

    await persist_runtime_environment_state(
        db_session,
        environment,
        runtime_url="https://rotated.invalid",
    )

    assert environment.runtime_url == "https://rotated.invalid"
    assert environment.runtime_generation == 7


@pytest.mark.asyncio
async def test_runtime_process_identity_checkpoint_increments_generation(db_session) -> None:
    environment = _environment()
    db_session.add(environment)
    await db_session.flush()

    await persist_runtime_environment_state(
        db_session,
        environment,
        runtime_url="https://relaunched.invalid",
        runtime_token_ciphertext="new-token",
        increment_runtime_generation=True,
    )

    assert environment.runtime_url == "https://relaunched.invalid"
    assert environment.runtime_token_ciphertext == "new-token"
    assert environment.runtime_generation == 8
