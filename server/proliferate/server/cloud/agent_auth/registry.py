"""Runtime registry projection for cloud agent-auth policy."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

from proliferate.constants.agent_catalog import AGENT_REGISTRY_RELATIVE_PATH

AgentAuthMaterializationMode = Literal["gateway_env", "synced_files"]
AgentAuthProtocolFacade = Literal["anthropic", "openai", "genai"]


@dataclass(frozen=True)
class RegistryGatewayEnvPolicy:
    protocol_facade: AgentAuthProtocolFacade
    protected_env_keys: frozenset[str]
    support_env_keys: frozenset[str]


@dataclass(frozen=True)
class RegistrySyncedFilesPolicy:
    protected_env_keys: frozenset[str]
    allowed_file_paths: frozenset[str]
    cleanup_file_paths: frozenset[str]


@dataclass(frozen=True)
class RegistryAuthSlot:
    agent_kind: str
    auth_slot_id: str
    label: str
    credential_provider_ids: tuple[str, ...]
    required_for_readiness: bool
    discovery: str
    gateway_env: RegistryGatewayEnvPolicy | None
    synced_files: RegistrySyncedFilesPolicy | None


def _resolve_registry_path(service_path: Path | None = None) -> Path:
    resolved_path = service_path or Path(__file__).resolve()
    candidates = (
        resolved_path.parents[4] / AGENT_REGISTRY_RELATIVE_PATH,
        resolved_path.parents[5] / AGENT_REGISTRY_RELATIVE_PATH,
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


REGISTRY_PATH = _resolve_registry_path()


@cache
def registry_auth_slots() -> tuple[RegistryAuthSlot, ...]:
    raw = json.loads(REGISTRY_PATH.read_text())
    slots: list[RegistryAuthSlot] = []
    for agent in raw.get("agents", []):
        agent_kind = str(agent.get("kind", ""))
        for slot in agent.get("auth", {}).get("slots", []):
            materialization = slot.get("materialization") or {}
            gateway = materialization.get("gatewayEnv")
            synced = materialization.get("syncedFiles")
            slots.append(
                RegistryAuthSlot(
                    agent_kind=agent_kind,
                    auth_slot_id=str(slot.get("id", "")),
                    label=str(slot.get("label", "")),
                    credential_provider_ids=tuple(
                        str(item) for item in slot.get("credentialProviderIds", [])
                    ),
                    required_for_readiness=bool(slot.get("requiredForReadiness")),
                    discovery=str(slot.get("discovery", "none")),
                    gateway_env=(
                        RegistryGatewayEnvPolicy(
                            protocol_facade=str(gateway.get("protocolFacade")),
                            protected_env_keys=frozenset(
                                str(item) for item in gateway.get("protectedEnvKeys", [])
                            ),
                            support_env_keys=frozenset(
                                str(item) for item in gateway.get("supportEnvKeys", [])
                            ),
                        )
                        if isinstance(gateway, dict)
                        else None
                    ),
                    synced_files=(
                        RegistrySyncedFilesPolicy(
                            protected_env_keys=frozenset(
                                str(item) for item in synced.get("protectedEnvKeys", [])
                            ),
                            allowed_file_paths=frozenset(
                                str(item) for item in synced.get("allowedFilePaths", [])
                            ),
                            cleanup_file_paths=frozenset(
                                str(item) for item in synced.get("cleanupFilePaths", [])
                            ),
                        )
                        if isinstance(synced, dict)
                        else None
                    ),
                )
            )
    return tuple(slots)


def auth_slot(agent_kind: str, auth_slot_id: str) -> RegistryAuthSlot | None:
    return next(
        (
            slot
            for slot in registry_auth_slots()
            if slot.agent_kind == agent_kind and slot.auth_slot_id == auth_slot_id
        ),
        None,
    )


def default_auth_slot_id(agent_kind: str) -> str | None:
    required = next(
        (
            slot.auth_slot_id
            for slot in registry_auth_slots()
            if slot.agent_kind == agent_kind and slot.required_for_readiness
        ),
        None,
    )
    if required is not None:
        return required
    return next(
        (slot.auth_slot_id for slot in registry_auth_slots() if slot.agent_kind == agent_kind),
        None,
    )


def credential_provider_id_for_provider_kind(provider_kind: str) -> str:
    if provider_kind in {
        "anthropic_api_key",
        "bedrock_assume_role",
        "proliferate_bedrock_pool",
        "proliferate_managed_anthropic",
    }:
        return "anthropic"
    if provider_kind in {
        "openai_api_key",
        "openai_compatible",
        "proliferate_managed_openai",
    }:
        return "openai"
    if provider_kind in {"gemini_api_key", "proliferate_managed_gemini"}:
        return "gemini"
    raise ValueError(f"Unsupported provider kind: {provider_kind}")


def slot_allows_credential_provider(
    *,
    agent_kind: str,
    auth_slot_id: str,
    credential_provider_id: str,
) -> bool:
    slot = auth_slot(agent_kind, auth_slot_id)
    return slot is not None and credential_provider_id in slot.credential_provider_ids


def materialization_mode_for_slot(
    *,
    agent_kind: str,
    auth_slot_id: str,
    credential_kind: str,
) -> AgentAuthMaterializationMode | None:
    slot = auth_slot(agent_kind, auth_slot_id)
    if slot is None:
        return None
    if credential_kind == "managed_gateway" and slot.gateway_env is not None:
        return "gateway_env"
    if credential_kind == "synced_path" and slot.synced_files is not None:
        return "synced_files"
    return None


def protocol_facade_for_slot(
    agent_kind: str,
    auth_slot_id: str,
) -> AgentAuthProtocolFacade | None:
    slot = auth_slot(agent_kind, auth_slot_id)
    if slot is None or slot.gateway_env is None:
        return None
    return slot.gateway_env.protocol_facade


def protected_env_keys_for_slot(
    *,
    agent_kind: str,
    auth_slot_id: str,
    materialization_mode: str,
) -> frozenset[str]:
    slot = auth_slot(agent_kind, auth_slot_id)
    if slot is None:
        return frozenset()
    if materialization_mode == "gateway_env" and slot.gateway_env is not None:
        return slot.gateway_env.protected_env_keys
    if materialization_mode == "synced_files" and slot.synced_files is not None:
        return slot.synced_files.protected_env_keys
    return frozenset()


def synced_file_paths_for_slot(agent_kind: str, auth_slot_id: str) -> frozenset[str]:
    slot = auth_slot(agent_kind, auth_slot_id)
    if slot is None or slot.synced_files is None:
        return frozenset()
    return slot.synced_files.allowed_file_paths


def cleanup_file_paths_for_slot(agent_kind: str, auth_slot_id: str) -> frozenset[str]:
    slot = auth_slot(agent_kind, auth_slot_id)
    if slot is None or slot.synced_files is None:
        return frozenset()
    return slot.synced_files.cleanup_file_paths
