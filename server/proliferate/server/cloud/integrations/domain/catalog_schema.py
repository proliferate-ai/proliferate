from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import yaml

from proliferate.server.cloud.errors import CloudApiError

_NAMESPACE_RE = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,127}$")


@dataclass(frozen=True)
class IntegrationAuthMode:
    kind: Literal["oauth2", "api_key", "none"]
    client_strategy: Literal["dcr", "client_metadata_document", "static"] | None = None
    label: str | None = None
    placement: dict[str, object] | None = None
    client_id_env: str | None = None
    client_secret_env: str | None = None
    token_endpoint_auth_method_env: str | None = None


@dataclass(frozen=True)
class IntegrationSettingOption:
    value: str
    label: str


@dataclass(frozen=True)
class IntegrationSetting:
    id: str
    label: str
    default: str
    options: tuple[IntegrationSettingOption, ...]


@dataclass(frozen=True)
class CatalogIntegrationDefinition:
    key: str
    display_name: str
    namespace: str
    provider_group: str | None
    transport: Literal["http"]
    implementation: Literal["upstream_mcp", "virtual_proliferate_mcp"]
    mcp_url: str | None
    mcp_url_by_setting: dict[str, object] | None
    default_enabled: bool
    auth_modes: tuple[IntegrationAuthMode, ...]
    settings: tuple[IntegrationSetting, ...]
    flags: dict[str, object]
    icon_id: str | None
    tool_surface_kind: str


@dataclass(frozen=True)
class IntegrationCatalog:
    version: int
    definitions: tuple[CatalogIntegrationDefinition, ...]


def load_catalog(path: Path) -> IntegrationCatalog:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise CloudApiError("invalid_catalog", "Integration catalog is invalid.", status_code=500)
    version = _int_value(payload.get("version"), field="version")
    definitions_value = payload.get("definitions")
    if not isinstance(definitions_value, list):
        raise CloudApiError(
            "invalid_catalog", "Integration catalog definitions are invalid.", status_code=500
        )
    definitions = tuple(_parse_definition(item) for item in definitions_value)
    return IntegrationCatalog(version=version, definitions=definitions)


def definition_config_json(definition: CatalogIntegrationDefinition) -> str:
    return canonical_json(
        {
            "mcpUrl": definition.mcp_url,
            "mcpUrlBySetting": definition.mcp_url_by_setting,
            "authModes": [_auth_mode_payload(mode) for mode in definition.auth_modes],
            "settings": [_setting_payload(setting) for setting in definition.settings],
            "flags": definition.flags,
            "iconId": definition.icon_id,
            "toolSurfaceKind": definition.tool_surface_kind,
        }
    )


def definition_content_hash(definition: CatalogIntegrationDefinition) -> str:
    return content_hash(
        {
            "key": definition.key,
            "displayName": definition.display_name,
            "namespace": definition.namespace,
            "providerGroup": definition.provider_group,
            "transport": definition.transport,
            "implementation": definition.implementation,
            "config": json.loads(definition_config_json(definition)),
            "defaultEnabled": definition.default_enabled,
        }
    )


def parse_definition_config(config_json: str) -> dict[str, object]:
    parsed = json.loads(config_json or "{}")
    if not isinstance(parsed, dict):
        return {}
    return parsed


def auth_modes_from_config(config: dict[str, object]) -> tuple[IntegrationAuthMode, ...]:
    modes = config.get("authModes")
    if not isinstance(modes, list):
        return ()
    return tuple(_parse_auth_mode(mode) for mode in modes if isinstance(mode, dict))


def default_settings_from_config(config: dict[str, object]) -> dict[str, str]:
    result: dict[str, str] = {}
    settings = config.get("settings")
    if not isinstance(settings, list):
        return result
    for setting in settings:
        if not isinstance(setting, dict):
            continue
        setting_id = setting.get("id")
        default = setting.get("default")
        if isinstance(setting_id, str) and isinstance(default, str):
            result[setting_id] = default
    return result


def render_mcp_url(config: dict[str, object], settings: dict[str, object] | None = None) -> str:
    direct = config.get("mcpUrl")
    if isinstance(direct, str) and direct:
        return direct
    by_setting = config.get("mcpUrlBySetting")
    if not isinstance(by_setting, dict):
        raise CloudApiError(
            "integration_config_invalid", "Integration MCP URL is missing.", status_code=409
        )
    setting_id = by_setting.get("settingId")
    variants = by_setting.get("variants")
    if not isinstance(setting_id, str) or not isinstance(variants, list):
        raise CloudApiError(
            "integration_config_invalid",
            "Integration MCP URL selector is invalid.",
            status_code=409,
        )
    resolved_settings = {**default_settings_from_config(config), **(settings or {})}
    selected = str(resolved_settings.get(setting_id, ""))
    for variant in variants:
        if not isinstance(variant, dict):
            continue
        if variant.get("value") == selected and isinstance(variant.get("url"), str):
            return str(variant["url"])
    raise CloudApiError(
        "integration_settings_invalid", "Integration URL setting is invalid.", status_code=400
    )


def validate_custom_definition_input(
    *,
    display_name: str,
    namespace: str,
    mcp_url: str,
) -> tuple[str, str, str]:
    cleaned_display_name = display_name.strip()
    cleaned_namespace = namespace.strip().lower()
    cleaned_mcp_url = mcp_url.strip()
    if not cleaned_display_name:
        raise CloudApiError("invalid_payload", "Display name is required.", status_code=400)
    if not _NAMESPACE_RE.fullmatch(cleaned_namespace):
        raise CloudApiError(
            "invalid_payload",
            "Namespace must be lowercase letters, numbers, or underscores.",
            status_code=400,
        )
    _require_https_url(cleaned_mcp_url)
    return cleaned_display_name, cleaned_namespace, cleaned_mcp_url


def custom_definition_config_json(*, mcp_url: str, client_strategy: str) -> str:
    return canonical_json(
        {
            "mcpUrl": mcp_url,
            "authModes": [{"kind": "oauth2", "clientStrategy": client_strategy}],
            "settings": [],
            "flags": {},
            "iconId": None,
            "toolSurfaceKind": "standard",
        }
    )


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def content_hash(value: object) -> str:
    return f"sha256:{hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()}"


def _parse_definition(value: object) -> CatalogIntegrationDefinition:
    if not isinstance(value, dict):
        raise CloudApiError(
            "invalid_catalog", "Integration catalog definition is invalid.", status_code=500
        )
    key = _str_value(value.get("key"), field="key")
    if not _KEY_RE.fullmatch(key):
        raise CloudApiError("invalid_catalog", f"Invalid integration key: {key}", status_code=500)
    namespace = _str_value(value.get("namespace"), field="namespace")
    if not _NAMESPACE_RE.fullmatch(namespace):
        raise CloudApiError(
            "invalid_catalog", f"Invalid integration namespace: {namespace}", status_code=500
        )
    transport = _str_value(value.get("transport"), field="transport")
    if transport != "http":
        raise CloudApiError(
            "invalid_catalog", "Only HTTP integrations are supported.", status_code=500
        )
    implementation = str(value.get("implementation") or "upstream_mcp")
    if implementation not in {"upstream_mcp", "virtual_proliferate_mcp"}:
        raise CloudApiError(
            "invalid_catalog", "Invalid integration implementation.", status_code=500
        )
    mcp_url = value.get("mcpUrl")
    mcp_url_by_setting = value.get("mcpUrlBySetting")
    if isinstance(mcp_url, str):
        _require_https_url(mcp_url)
    elif isinstance(mcp_url_by_setting, dict):
        _validate_url_by_setting(mcp_url_by_setting)
    else:
        raise CloudApiError("invalid_catalog", "Integration MCP URL is required.", status_code=500)
    auth_modes_value = value.get("authModes")
    if not isinstance(auth_modes_value, list):
        raise CloudApiError(
            "invalid_catalog", "Integration auth modes are required.", status_code=500
        )
    return CatalogIntegrationDefinition(
        key=key,
        display_name=_str_value(value.get("displayName"), field="displayName"),
        namespace=namespace,
        provider_group=_optional_str(value.get("providerGroup")),
        transport="http",
        implementation=implementation,  # type: ignore[arg-type]
        mcp_url=mcp_url if isinstance(mcp_url, str) else None,
        mcp_url_by_setting=mcp_url_by_setting if isinstance(mcp_url_by_setting, dict) else None,
        default_enabled=bool(value.get("defaultEnabled", True)),
        auth_modes=tuple(
            _parse_auth_mode(item) for item in auth_modes_value if isinstance(item, dict)
        ),
        settings=tuple(
            _parse_setting(item) for item in value.get("settings", []) if isinstance(item, dict)
        ),
        flags=value.get("flags") if isinstance(value.get("flags"), dict) else {},
        icon_id=_optional_str(value.get("iconId")),
        tool_surface_kind=str(value.get("toolSurfaceKind") or "standard"),
    )


def _parse_auth_mode(value: dict[str, object]) -> IntegrationAuthMode:
    kind = str(value.get("kind") or "")
    if kind not in {"oauth2", "api_key", "none"}:
        raise CloudApiError("invalid_catalog", "Invalid integration auth mode.", status_code=500)
    client_strategy = value.get("clientStrategy")
    if client_strategy is not None and client_strategy not in {
        "dcr",
        "client_metadata_document",
        "static",
    }:
        raise CloudApiError("invalid_catalog", "Invalid OAuth client strategy.", status_code=500)
    placement = value.get("placement")
    return IntegrationAuthMode(
        kind=kind,  # type: ignore[arg-type]
        client_strategy=client_strategy if isinstance(client_strategy, str) else None,  # type: ignore[arg-type]
        label=_optional_str(value.get("label")),
        placement=placement if isinstance(placement, dict) else None,
        client_id_env=_optional_str(value.get("clientIdEnv")),
        client_secret_env=_optional_str(value.get("clientSecretEnv")),
        token_endpoint_auth_method_env=_optional_str(value.get("tokenEndpointAuthMethodEnv")),
    )


def _parse_setting(value: dict[str, object]) -> IntegrationSetting:
    options = value.get("options")
    parsed_options = (
        tuple(
            IntegrationSettingOption(
                value=_str_value(option.get("value"), field="setting option value"),
                label=_str_value(option.get("label"), field="setting option label"),
            )
            for option in options
            if isinstance(option, dict)
        )
        if isinstance(options, list)
        else ()
    )
    return IntegrationSetting(
        id=_str_value(value.get("id"), field="setting id"),
        label=_str_value(value.get("label"), field="setting label"),
        default=_str_value(value.get("default"), field="setting default"),
        options=parsed_options,
    )


def _setting_payload(setting: IntegrationSetting) -> dict[str, object]:
    return {
        "id": setting.id,
        "label": setting.label,
        "default": setting.default,
        "options": [{"value": option.value, "label": option.label} for option in setting.options],
    }


def _auth_mode_payload(mode: IntegrationAuthMode) -> dict[str, object]:
    payload: dict[str, object] = {"kind": mode.kind}
    if mode.client_strategy:
        payload["clientStrategy"] = mode.client_strategy
    if mode.label:
        payload["label"] = mode.label
    if mode.placement:
        payload["placement"] = mode.placement
    if mode.client_id_env:
        payload["clientIdEnv"] = mode.client_id_env
    if mode.client_secret_env:
        payload["clientSecretEnv"] = mode.client_secret_env
    if mode.token_endpoint_auth_method_env:
        payload["tokenEndpointAuthMethodEnv"] = mode.token_endpoint_auth_method_env
    return payload


def _validate_url_by_setting(value: dict[str, object]) -> None:
    variants = value.get("variants")
    if not isinstance(variants, list) or not variants:
        raise CloudApiError(
            "invalid_catalog", "URL-by-setting variants are required.", status_code=500
        )
    for variant in variants:
        if isinstance(variant, dict) and isinstance(variant.get("url"), str):
            _require_https_url(str(variant["url"]))


def _require_https_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise CloudApiError("invalid_payload", "MCP URL must be an HTTPS URL.", status_code=400)


def _str_value(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CloudApiError(
            "invalid_catalog", f"Integration catalog field {field} is required.", status_code=500
        )
    return value.strip()


def _optional_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _int_value(value: object, *, field: str) -> int:
    if not isinstance(value, int):
        raise CloudApiError(
            "invalid_catalog", f"Integration catalog field {field} is required.", status_code=500
        )
    return value
