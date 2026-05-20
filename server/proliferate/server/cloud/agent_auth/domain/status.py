from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from proliferate.constants.cloud import SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS, CloudAgentKind
from proliferate.server.cloud.agent_auth.domain.types import SyncedCredentialAuthMode

_DEFAULT_AUTH_MODES: dict[CloudAgentKind, SyncedCredentialAuthMode] = {
    "claude": "env",
    "codex": "file",
    "gemini": "env",
}


@dataclass(frozen=True)
class CredentialStatusRecord:
    provider: CloudAgentKind
    auth_mode: SyncedCredentialAuthMode
    supported: bool
    local_detected: bool
    synced: bool
    last_synced_at: str | None


def build_credential_statuses(
    records: Sequence[object],
) -> list[CredentialStatusRecord]:
    by_provider: dict[str, object] = {}
    for record in records:
        provider = getattr(record, "provider", None)
        if (
            provider in SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS
            and getattr(record, "revoked_at", None) is None
        ):
            by_provider[provider] = record

    statuses: list[CredentialStatusRecord] = []
    for provider in SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS:
        record = by_provider.get(provider)
        raw_auth_mode = (
            getattr(record, "auth_mode", None) if record else None
        ) or _DEFAULT_AUTH_MODES.get(provider, "env")
        auth_mode: SyncedCredentialAuthMode = (
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


def allowed_agent_kinds() -> list[CloudAgentKind]:
    return list(SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS)


def ready_agent_kinds(statuses: Sequence[CredentialStatusRecord]) -> list[CloudAgentKind]:
    return [status.provider for status in statuses if status.synced]


def _to_iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)
