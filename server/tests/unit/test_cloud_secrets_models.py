from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from proliferate.db.store.cloud_secrets import CloudSecretFileValue, CloudSecretSetValue
from proliferate.db.store.managed_sandbox_secrets import (
    ManagedSandboxSecretMaterializationValue,
)
from proliferate.server.cloud.secrets.models import cloud_secrets_payload
from proliferate.server.cloud.secrets.service import _should_repair_stale_materialization


def _workspace_secret_set(
    *,
    cloud_repo_config_id: UUID,
    version: int,
) -> CloudSecretSetValue:
    now = datetime.now(UTC)
    return CloudSecretSetValue(
        id=uuid4(),
        scope_kind="workspace",
        user_id=None,
        organization_id=None,
        cloud_repo_config_id=cloud_repo_config_id,
        version=version,
        created_by_user_id=uuid4(),
        updated_by_user_id=uuid4(),
        created_at=now,
        updated_at=now,
        env_vars=(),
        files=(
            CloudSecretFileValue(
                id=uuid4(),
                secret_set_id=uuid4(),
                path=".env",
                content_sha256="abc",
                byte_size=9,
                created_at=now,
                updated_at=now,
            ),
        ),
    )


def _workspace_materialization(
    *,
    cloud_repo_config_id: UUID,
    applied_version: int,
    status: str = "ready",
) -> ManagedSandboxSecretMaterializationValue:
    now = datetime.now(UTC)
    return ManagedSandboxSecretMaterializationValue(
        id=uuid4(),
        managed_sandbox_id=uuid4(),
        materialization_kind="workspace",
        cloud_secret_set_id=uuid4(),
        cloud_repo_config_id=cloud_repo_config_id,
        sandbox_generation=1,
        applied_version=applied_version,
        applied_versions={f"workspace:{cloud_repo_config_id}": applied_version},
        applied_manifest={},
        status=status,
        last_error=None,
        materialized_at=now,
        created_at=now,
        updated_at=now,
    )


def test_cloud_secrets_payload_marks_ready_materialization_pending_when_version_is_stale() -> None:
    cloud_repo_config_id = uuid4()
    secret_set = _workspace_secret_set(
        cloud_repo_config_id=cloud_repo_config_id,
        version=1,
    )
    materialization = _workspace_materialization(
        cloud_repo_config_id=cloud_repo_config_id,
        applied_version=0,
    )

    payload = cloud_secrets_payload(secret_set, materialization=materialization)

    assert payload.materialization is not None
    assert payload.materialization.status == "pending"
    assert payload.materialization.materialized_at is None
    assert _should_repair_stale_materialization(secret_set, materialization)


def test_cloud_secrets_payload_keeps_ready_materialization_ready_when_version_is_current() -> None:
    cloud_repo_config_id = uuid4()
    secret_set = _workspace_secret_set(
        cloud_repo_config_id=cloud_repo_config_id,
        version=1,
    )
    materialization = _workspace_materialization(
        cloud_repo_config_id=cloud_repo_config_id,
        applied_version=1,
    )

    payload = cloud_secrets_payload(secret_set, materialization=materialization)

    assert payload.materialization is not None
    assert payload.materialization.status == "ready"
    assert payload.materialization.materialized_at is not None
    assert not _should_repair_stale_materialization(secret_set, materialization)
