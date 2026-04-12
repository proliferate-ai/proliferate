"""Request schemas and domain types for cloud credentials."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from proliferate.constants.cloud import (
    SUPPORTED_CLOUD_AGENTS,
)
from proliferate.constants.cloud import CloudAgentKind as CloudAgentKind

CloudCredentialAuthMode = Literal["env", "file"]

_DEFAULT_AUTH_MODES: dict[str, CloudCredentialAuthMode] = {
    "claude": "env",
    "codex": "file",
    "gemini": "env",
}


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


# ---------------------------------------------------------------------------
# Credential status domain types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CredentialStatusRecord:
    provider: CloudAgentKind
    auth_mode: CloudCredentialAuthMode
    supported: bool
    local_detected: bool
    synced: bool
    last_synced_at: str | None


class CredentialStatus(BaseModel):
    provider: str
    auth_mode: CloudCredentialAuthMode = Field(serialization_alias="authMode")
    supported: bool
    local_detected: bool = Field(serialization_alias="localDetected")
    synced: bool
    last_synced_at: str | None = Field(default=None, serialization_alias="lastSyncedAt")


def _to_iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def build_credential_statuses(
    records: Sequence[object],
) -> list[CredentialStatusRecord]:
    """Build status records from a sequence of ORM credential rows.

    Each element is expected to have ``provider``, ``auth_mode``,
    ``revoked_at``, and ``last_synced_at`` attributes (i.e. the
    ``CloudCredential`` ORM model).
    """
    by_provider: dict[str, object] = {}
    for record in records:
        provider = getattr(record, "provider", None)
        if provider in SUPPORTED_CLOUD_AGENTS and getattr(record, "revoked_at", None) is None:
            by_provider[provider] = record

    statuses: list[CredentialStatusRecord] = []
    for provider in SUPPORTED_CLOUD_AGENTS:
        record = by_provider.get(provider)
        raw_auth_mode = (
            getattr(record, "auth_mode", None) if record else None
        ) or _DEFAULT_AUTH_MODES.get(provider, "env")
        auth_mode: CloudCredentialAuthMode = (
            raw_auth_mode if raw_auth_mode in ("env", "file") else "env"
        )
        last_synced_at = _to_iso(getattr(record, "last_synced_at", None)) if record else None
        statuses.append(
            CredentialStatusRecord(
                provider=provider,
                auth_mode=auth_mode,
                supported=True,
                local_detected=False,
                synced=record is not None,
                last_synced_at=last_synced_at,
            )
        )
    return statuses


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


def allowed_agent_kinds() -> list[str]:
    """Return the list of provider names that the platform supports."""
    return list(SUPPORTED_CLOUD_AGENTS)


def ready_agent_kinds(statuses: Sequence[CredentialStatusRecord]) -> list[str]:
    """Return provider names that have a synced credential."""
    return [status.provider for status in statuses if status.synced]
