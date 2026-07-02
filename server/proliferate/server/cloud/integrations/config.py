"""Codec for ``CloudIntegrationDefinition.config_json``.

Defines frozen dataclasses describing an integration's MCP launch + auth
config, plus parse/serialize helpers between those dataclasses and the JSON
string stored in ``cloud_integration_definition.config_json``.

Ported from the old MCP catalog domain types
(``server/proliferate/server/cloud/mcp_catalog/domain/types.py`` and
``domain/builders.py`` as of commit ``4b54c9f2b``), collapsed into a single
per-definition config shape.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal, cast, get_args

Transport = Literal["http", "stdio"]
SettingKind = Literal["string", "boolean", "select", "url"]
ArgKind = Literal["static", "workspace_path", "secret", "setting"]
EnvKind = Literal["static", "secret", "setting"]


class IntegrationConfigError(ValueError):
    """Raised when an integration config cannot be parsed or rendered."""


# --------------------------------------------------------------------------- #
# URL specs
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class StaticUrl:
    """A fixed MCP endpoint URL."""

    value: str


@dataclass(frozen=True)
class UrlBySetting:
    """An MCP endpoint chosen by the value of a settings field.

    ``variants`` maps a settings value (e.g. ``"us"``/``"eu"``) to a URL.
    ``default`` is the URL used when the setting is missing or unrecognized.
    """

    setting_id: str
    variants: dict[str, str]
    default: str


UrlSpec = StaticUrl | UrlBySetting


# --------------------------------------------------------------------------- #
# Header / query templates (values may contain {secret.X} / {settings.X})
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class HeaderTemplate:
    name: str
    value: str
    optional: bool = False


@dataclass(frozen=True)
class QueryTemplate:
    name: str
    value: str
    optional: bool = False


# --------------------------------------------------------------------------- #
# Secret + setting field schemas
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class SecretField:
    id: str
    label: str
    placeholder: str | None = None
    helper_text: str | None = None
    prefix_hint: str | None = None


@dataclass(frozen=True)
class SettingOption:
    value: str
    label: str


@dataclass(frozen=True)
class SettingField:
    id: str
    label: str
    kind: SettingKind
    required: bool = False
    default: str | bool | None = None
    options: tuple[SettingOption, ...] = ()
    affects_url: bool = False


# --------------------------------------------------------------------------- #
# stdio launch templates (reserved for future stdio connectors, e.g. gmail)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ArgTemplate:
    kind: ArgKind
    value: str | None = None
    field_id: str | None = None


@dataclass(frozen=True)
class EnvTemplate:
    name: str
    kind: EnvKind
    value: str | None = None
    field_id: str | None = None


# --------------------------------------------------------------------------- #
# Top-level config
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class IntegrationConfig:
    transport: Transport = "http"
    url: UrlSpec | None = None
    display_url: str = ""
    headers: tuple[HeaderTemplate, ...] = ()
    query: tuple[QueryTemplate, ...] = ()
    secret_fields: tuple[SecretField, ...] = ()
    settings_fields: tuple[SettingField, ...] = ()
    cloud_secret_sync: bool = False
    command: str | None = None
    args: tuple[ArgTemplate, ...] = field(default_factory=tuple)
    env: tuple[EnvTemplate, ...] = field(default_factory=tuple)


# --------------------------------------------------------------------------- #
# Serialize
# --------------------------------------------------------------------------- #


def _url_to_json(url: UrlSpec | None) -> dict[str, Any] | None:
    if url is None:
        return None
    if isinstance(url, StaticUrl):
        return {"kind": "static", "value": url.value}
    if isinstance(url, UrlBySetting):
        return {
            "kind": "by_setting",
            "settingId": url.setting_id,
            "variants": dict(url.variants),
            "default": url.default,
        }
    raise IntegrationConfigError(f"unsupported url spec: {url!r}")


def _header_to_json(header: HeaderTemplate) -> dict[str, Any]:
    return {"name": header.name, "value": header.value, "optional": header.optional}


def _query_to_json(query: QueryTemplate) -> dict[str, Any]:
    return {"name": query.name, "value": query.value, "optional": query.optional}


def _secret_field_to_json(f: SecretField) -> dict[str, Any]:
    return {
        "id": f.id,
        "label": f.label,
        "placeholder": f.placeholder,
        "helperText": f.helper_text,
        "prefixHint": f.prefix_hint,
    }


def _setting_field_to_json(f: SettingField) -> dict[str, Any]:
    return {
        "id": f.id,
        "label": f.label,
        "kind": f.kind,
        "required": f.required,
        "default": f.default,
        "options": [{"value": o.value, "label": o.label} for o in f.options],
        "affectsUrl": f.affects_url,
    }


def _arg_to_json(a: ArgTemplate) -> dict[str, Any]:
    return {"kind": a.kind, "value": a.value, "fieldId": a.field_id}


def _env_to_json(e: EnvTemplate) -> dict[str, Any]:
    return {"name": e.name, "kind": e.kind, "value": e.value, "fieldId": e.field_id}


def serialize_definition_config(cfg: IntegrationConfig) -> str:
    payload: dict[str, Any] = {
        "version": 1,
        "transport": cfg.transport,
        "url": _url_to_json(cfg.url),
        "displayUrl": cfg.display_url,
        "headers": [_header_to_json(h) for h in cfg.headers],
        "query": [_query_to_json(q) for q in cfg.query],
        "secretFields": [_secret_field_to_json(f) for f in cfg.secret_fields],
        "settingsFields": [_setting_field_to_json(f) for f in cfg.settings_fields],
        "cloudSecretSync": cfg.cloud_secret_sync,
        "command": cfg.command,
        "args": [_arg_to_json(a) for a in cfg.args],
        "env": [_env_to_json(e) for e in cfg.env],
    }
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


# --------------------------------------------------------------------------- #
# Parse
# --------------------------------------------------------------------------- #


def _url_from_json(raw: object) -> UrlSpec | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise IntegrationConfigError("url must be an object")
    kind = raw.get("kind")
    if kind == "static":
        return StaticUrl(value=str(raw["value"]))
    if kind == "by_setting":
        variants = raw.get("variants") or {}
        if not isinstance(variants, dict):
            raise IntegrationConfigError("url.variants must be an object")
        return UrlBySetting(
            setting_id=str(raw["settingId"]),
            variants={str(k): str(v) for k, v in variants.items()},
            default=str(raw["default"]),
        )
    raise IntegrationConfigError(f"unsupported url kind: {kind!r}")


def _header_from_json(raw: dict[str, Any]) -> HeaderTemplate:
    return HeaderTemplate(
        name=str(raw["name"]),
        value=str(raw["value"]),
        optional=bool(raw.get("optional", False)),
    )


def _query_from_json(raw: dict[str, Any]) -> QueryTemplate:
    return QueryTemplate(
        name=str(raw["name"]),
        value=str(raw["value"]),
        optional=bool(raw.get("optional", False)),
    )


def _secret_field_from_json(raw: dict[str, Any]) -> SecretField:
    return SecretField(
        id=str(raw["id"]),
        label=str(raw["label"]),
        placeholder=raw.get("placeholder"),
        helper_text=raw.get("helperText"),
        prefix_hint=raw.get("prefixHint"),
    )


def _setting_kind_from_json(raw: object) -> SettingKind:
    kind = str(raw)
    if kind not in get_args(SettingKind):
        raise IntegrationConfigError(f"unsupported setting kind: {kind!r}")
    return cast(SettingKind, kind)


def _arg_kind_from_json(raw: object) -> ArgKind:
    kind = str(raw)
    if kind not in get_args(ArgKind):
        raise IntegrationConfigError(f"unsupported arg kind: {kind!r}")
    return cast(ArgKind, kind)


def _env_kind_from_json(raw: object) -> EnvKind:
    kind = str(raw)
    if kind not in get_args(EnvKind):
        raise IntegrationConfigError(f"unsupported env kind: {kind!r}")
    return cast(EnvKind, kind)


def _setting_field_from_json(raw: dict[str, Any]) -> SettingField:
    options = tuple(
        SettingOption(value=str(o["value"]), label=str(o["label"])) for o in raw.get("options", ())
    )
    return SettingField(
        id=str(raw["id"]),
        label=str(raw["label"]),
        kind=_setting_kind_from_json(raw["kind"]),
        required=bool(raw.get("required", False)),
        default=raw.get("default"),
        options=options,
        affects_url=bool(raw.get("affectsUrl", False)),
    )


def _arg_from_json(raw: dict[str, Any]) -> ArgTemplate:
    return ArgTemplate(
        kind=_arg_kind_from_json(raw["kind"]),
        value=raw.get("value"),
        field_id=raw.get("fieldId"),
    )


def _env_from_json(raw: dict[str, Any]) -> EnvTemplate:
    return EnvTemplate(
        name=str(raw["name"]),
        kind=_env_kind_from_json(raw["kind"]),
        value=raw.get("value"),
        field_id=raw.get("fieldId"),
    )


def parse_definition_config(config_json_str: str) -> IntegrationConfig:
    try:
        raw = json.loads(config_json_str or "{}")
    except json.JSONDecodeError as exc:
        raise IntegrationConfigError(f"invalid config_json: {exc}") from exc
    if not isinstance(raw, dict):
        raise IntegrationConfigError("config_json must decode to an object")

    transport = str(raw.get("transport", "http"))
    if transport not in ("http", "stdio"):
        raise IntegrationConfigError(f"unsupported transport: {transport!r}")

    return IntegrationConfig(
        transport=transport,  # type: ignore[arg-type]
        url=_url_from_json(raw.get("url")),
        display_url=str(raw.get("displayUrl", "")),
        headers=tuple(_header_from_json(h) for h in raw.get("headers", ())),
        query=tuple(_query_from_json(q) for q in raw.get("query", ())),
        secret_fields=tuple(_secret_field_from_json(f) for f in raw.get("secretFields", ())),
        settings_fields=tuple(_setting_field_from_json(f) for f in raw.get("settingsFields", ())),
        cloud_secret_sync=bool(raw.get("cloudSecretSync", False)),
        command=raw.get("command"),
        args=tuple(_arg_from_json(a) for a in raw.get("args", ())),
        env=tuple(_env_from_json(e) for e in raw.get("env", ())),
    )


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #


def render_mcp_url(cfg: IntegrationConfig, settings: dict[str, Any]) -> str:
    """Resolve the concrete MCP endpoint URL for ``cfg`` under ``settings``.

    - ``StaticUrl`` -> its ``value``.
    - ``UrlBySetting`` -> ``variants[settings[setting_id]]`` when present,
      otherwise ``default``.
    """
    url = cfg.url
    if url is None:
        raise IntegrationConfigError("config has no url to render")
    if isinstance(url, StaticUrl):
        return url.value
    if isinstance(url, UrlBySetting):
        selected = settings.get(url.setting_id)
        if selected is None:
            return url.default
        return url.variants.get(str(selected), url.default)
    raise IntegrationConfigError(f"unsupported url spec: {url!r}")
