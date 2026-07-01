"""Request and response models for cloud secrets."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sandbox_secrets import (
    CloudSandboxSecretMaterializationValue,
)
from proliferate.db.store.cloud_secrets import (
    CloudSecretEnvVarValue,
    CloudSecretFileValue,
    CloudSecretSetValue,
)


class CloudSecretEnvVarMetadata(BaseModel):
    id: str
    name: str
    byte_size: int = Field(serialization_alias="byteSize")
    updated_at: str = Field(serialization_alias="updatedAt")


class CloudSecretFileMetadata(BaseModel):
    id: str
    path: str
    byte_size: int = Field(serialization_alias="byteSize")
    updated_at: str = Field(serialization_alias="updatedAt")


class CloudSecretsMaterializationResponse(BaseModel):
    status: Literal["pending", "running", "ready", "error"]
    last_error: str | None = Field(serialization_alias="lastError")
    materialized_at: str | None = Field(serialization_alias="materializedAt")


class CloudSecretsResponse(BaseModel):
    scope_kind: Literal["personal", "organization", "workspace"] = Field(
        serialization_alias="scopeKind"
    )
    version: int
    env_vars: list[CloudSecretEnvVarMetadata] = Field(serialization_alias="envVars")
    files: list[CloudSecretFileMetadata]
    materialization: CloudSecretsMaterializationResponse | None = None


class PutCloudSecretEnvVarRequest(BaseModel):
    value: str


class PutCloudSecretFileRequest(BaseModel):
    path: str
    content: str


class DeleteCloudSecretFileRequest(BaseModel):
    path: str


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _env_payload(value: CloudSecretEnvVarValue) -> CloudSecretEnvVarMetadata:
    return CloudSecretEnvVarMetadata(
        id=str(value.id),
        name=value.name,
        byte_size=value.byte_size,
        updated_at=value.updated_at.isoformat(),
    )


def _file_payload(value: CloudSecretFileValue) -> CloudSecretFileMetadata:
    return CloudSecretFileMetadata(
        id=str(value.id),
        path=value.path,
        byte_size=value.byte_size,
        updated_at=value.updated_at.isoformat(),
    )


def _secret_set_materialization_key(value: CloudSecretSetValue) -> str:
    if value.scope_kind == "personal" and value.user_id is not None:
        return f"personal:{value.user_id}"
    if value.scope_kind == "organization" and value.organization_id is not None:
        return f"organization:{value.organization_id}"
    if value.scope_kind == "workspace" and value.repo_environment_id is not None:
        return f"workspace:{value.repo_environment_id}"
    return f"{value.scope_kind}:{value.id}"


def _secret_set_has_desired_state(value: CloudSecretSetValue) -> bool:
    return value.version > 0 and (len(value.env_vars) > 0 or len(value.files) > 0)


def _secret_set_materialization_current(
    value: CloudSecretSetValue,
    materialization: CloudSandboxSecretMaterializationValue,
) -> bool:
    return (
        materialization.applied_versions.get(_secret_set_materialization_key(value))
        == value.version
    )


def _materialization_payload(
    secret_set: CloudSecretSetValue,
    materialization: CloudSandboxSecretMaterializationValue | None,
) -> CloudSecretsMaterializationResponse:
    if materialization is None:
        return CloudSecretsMaterializationResponse(
            status="pending",
            last_error=None,
            materialized_at=None,
        )
    if (
        materialization.status == "ready"
        and _secret_set_has_desired_state(secret_set)
        and not _secret_set_materialization_current(secret_set, materialization)
    ):
        return CloudSecretsMaterializationResponse(
            status="pending",
            last_error=None,
            materialized_at=None,
        )
    return CloudSecretsMaterializationResponse(
        status=materialization.status,  # type: ignore[arg-type]
        last_error=materialization.last_error,
        materialized_at=_iso(materialization.materialized_at),
    )


def cloud_secrets_payload(
    value: CloudSecretSetValue,
    *,
    materialization: CloudSandboxSecretMaterializationValue | None,
) -> CloudSecretsResponse:
    return CloudSecretsResponse(
        scope_kind=value.scope_kind,  # type: ignore[arg-type]
        version=value.version,
        env_vars=[_env_payload(item) for item in value.env_vars],
        files=[_file_payload(item) for item in value.files],
        materialization=_materialization_payload(value, materialization),
    )
