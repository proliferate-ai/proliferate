"""Request and response models for cloud secrets."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_secrets import (
    CloudSecretEnvVarValue,
    CloudSecretFileValue,
    CloudSecretSetValue,
)
from proliferate.db.store.managed_sandbox_secrets import (
    ManagedSandboxSecretMaterializationValue,
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


def _materialization_payload(
    value: ManagedSandboxSecretMaterializationValue | None,
) -> CloudSecretsMaterializationResponse:
    if value is None:
        return CloudSecretsMaterializationResponse(
            status="pending",
            last_error=None,
            materialized_at=None,
        )
    return CloudSecretsMaterializationResponse(
        status=value.status,  # type: ignore[arg-type]
        last_error=value.last_error,
        materialized_at=_iso(value.materialized_at),
    )


def cloud_secrets_payload(
    value: CloudSecretSetValue,
    *,
    materialization: ManagedSandboxSecretMaterializationValue | None,
) -> CloudSecretsResponse:
    return CloudSecretsResponse(
        scope_kind=value.scope_kind,  # type: ignore[arg-type]
        version=value.version,
        env_vars=[_env_payload(item) for item in value.env_vars],
        files=[_file_payload(item) for item in value.files],
        materialization=_materialization_payload(materialization),
    )
