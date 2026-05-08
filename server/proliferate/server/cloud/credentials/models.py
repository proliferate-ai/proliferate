"""Request and response schemas for cloud credentials."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.server.cloud.credentials.domain.status import (
    CredentialStatusRecord,
)
from proliferate.server.cloud.credentials.domain.types import CloudCredentialAuthMode


class SyncClaudeEnvCredentialRequest(BaseModel):
    auth_mode: Literal["env"] = Field(alias="authMode")
    env_vars: dict[str, str] = Field(alias="envVars")


class SyncClaudeFileEntry(BaseModel):
    # This is always a slash-normalized path relative to the sandbox runtime
    # home directory, never a local absolute path from the desktop machine.
    relative_path: str = Field(alias="relativePath")
    content_base64: str = Field(alias="contentBase64")


class SyncClaudeFileCredentialRequest(BaseModel):
    auth_mode: Literal["file"] = Field(alias="authMode")
    files: list[SyncClaudeFileEntry]


SyncClaudeCredentialRequest = SyncClaudeEnvCredentialRequest | SyncClaudeFileCredentialRequest


class SyncCodexFile(BaseModel):
    # Codex cloud sync stores the canonical auth file under runtime home.
    relative_path: str = Field(alias="relativePath")
    content_base64: str = Field(alias="contentBase64")


class SyncCodexCredentialRequest(BaseModel):
    auth_mode: Literal["file"] = Field(alias="authMode")
    files: list[SyncCodexFile]


class SyncGeminiEnvCredentialRequest(BaseModel):
    auth_mode: Literal["env"] = Field(alias="authMode")
    env_vars: dict[str, str] = Field(alias="envVars")


class SyncGeminiFileEntry(BaseModel):
    relative_path: str = Field(alias="relativePath")
    content_base64: str = Field(alias="contentBase64")


class SyncGeminiFileCredentialRequest(BaseModel):
    auth_mode: Literal["file"] = Field(alias="authMode")
    files: list[SyncGeminiFileEntry]


SyncGeminiCredentialRequest = SyncGeminiEnvCredentialRequest | SyncGeminiFileCredentialRequest

SyncCloudCredentialRequest = (
    SyncClaudeCredentialRequest | SyncCodexCredentialRequest | SyncGeminiCredentialRequest
)


class CredentialStatus(BaseModel):
    provider: str
    auth_mode: CloudCredentialAuthMode = Field(serialization_alias="authMode")
    supported: bool
    local_detected: bool = Field(serialization_alias="localDetected")
    synced: bool
    last_synced_at: str | None = Field(default=None, serialization_alias="lastSyncedAt")


class CloudCredentialMutationResponse(BaseModel):
    ok: bool = True
    changed: bool


def credential_status_payload(status: CredentialStatusRecord) -> CredentialStatus:
    """Serialize a *CredentialStatusRecord* to its wire-format Pydantic model."""
    return CredentialStatus(
        provider=status.provider,
        auth_mode=status.auth_mode,
        supported=status.supported,
        local_detected=status.local_detected,
        synced=status.synced,
        last_synced_at=status.last_synced_at,
    )
