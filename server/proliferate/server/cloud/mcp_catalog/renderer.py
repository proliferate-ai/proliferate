from __future__ import annotations

import json
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from proliferate.server.cloud.mcp_catalog.types import (
    CatalogConfigurationError,
    CatalogEntry,
    CatalogSettingField,
    LaunchUrlContext,
    QueryTemplate,
    RenderedHeader,
    RenderedHttpLaunch,
    StaticUrl,
    UrlBySetting,
)

_PLACEHOLDER_RE = re.compile(r"\{(settings|secret)\.([A-Za-z0-9_.:-]+)\}")
_CRLF_RE = re.compile(r"[\r\n]")


def connector_supports_target(entry: CatalogEntry, target_location: str) -> bool:
    if entry.availability == "universal":
        return target_location in {"local", "cloud"}
    if entry.availability == "local_only":
        return target_location == "local"
    return target_location == "cloud"


def parse_settings(raw: str) -> dict[str, object]:
    try:
        value = json.loads(raw or "{}")
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def normalize_settings(
    entry: CatalogEntry,
    parsed: dict[str, object] | None,
) -> dict[str, object]:
    raw = dict(parsed or {})
    normalized: dict[str, object] = {}
    for field in entry.settings_fields:
        if field.id in raw:
            normalized_value = _normalize_setting_value(field, raw[field.id])
            if normalized_value is not None:
                normalized[field.id] = normalized_value
            continue
        if field.default_value is not None:
            normalized[field.id] = field.default_value
    return normalized


def validate_settings(
    entry: CatalogEntry,
    settings: dict[str, object] | None,
) -> dict[str, object]:
    normalized = normalize_settings(entry, settings)
    for field in entry.settings_fields:
        value = normalized.get(field.id)
        if value is None:
            if field.required:
                raise CatalogConfigurationError(f"{entry.name} requires a value for '{field.id}'.")
            continue
        _validate_setting_value(field, value)
    return normalized


def validate_secret_fields(
    entry: CatalogEntry,
    secret_fields: dict[str, str],
) -> dict[str, str]:
    if entry.auth_kind != "secret":
        raise CatalogConfigurationError(f"{entry.name} does not use API-key authentication.")
    required = {field.id for field in entry.secret_fields}
    cleaned: dict[str, str] = {}
    for raw_field_id, raw_value in secret_fields.items():
        field_id = raw_field_id.strip()
        if field_id not in required:
            raise CatalogConfigurationError(
                f"'{field_id}' is not a secret field for {entry.name}."
            )
        value = raw_value.strip()
        if not value:
            raise CatalogConfigurationError(
                f"Cloud connector sync requires a value for '{field_id}'."
            )
        cleaned[field_id] = value
    missing = sorted(required - set(cleaned))
    if missing:
        raise CatalogConfigurationError(
            f"Cloud connector sync requires values for: {', '.join(missing)}."
        )
    return cleaned


def render_http_launch(
    entry: CatalogEntry,
    settings: dict[str, object],
    *,
    secrets: dict[str, str] | None = None,
    launch_context: LaunchUrlContext = "catalog",
) -> RenderedHttpLaunch:
    if entry.http is None:
        raise CatalogConfigurationError(f"{entry.name} does not have an HTTP launch template.")
    normalized_settings = validate_settings(entry, settings)
    rendered_url = _render_launch_url(entry.http.url, normalized_settings)
    rendered_url = _append_query_templates(
        rendered_url,
        entry.http.query,
        normalized_settings,
        secrets or {},
    )
    _validate_launch_url(rendered_url, entry=entry, launch_context=launch_context)
    headers: list[RenderedHeader] = []
    for template in entry.http.headers:
        rendered = _render_template_value(
            template.value,
            normalized_settings,
            secrets or {},
            optional=template.optional,
        )
        if rendered is None:
            continue
        if _CRLF_RE.search(template.name) or _CRLF_RE.search(rendered):
            raise CatalogConfigurationError(f"{entry.name} produced an invalid header.")
        headers.append(RenderedHeader(name=template.name, value=rendered))
    return RenderedHttpLaunch(url=rendered_url, headers=tuple(headers))


def render_oauth_resource_url(
    entry: CatalogEntry,
    settings: dict[str, object],
) -> str:
    return render_http_launch(
        entry,
        settings,
        secrets=None,
        launch_context="oauth_resource",
    ).url


def _normalize_setting_value(
    field: CatalogSettingField,
    value: object,
) -> str | bool | None:
    if field.kind == "boolean":
        return value if isinstance(value, bool) else None
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned and not field.required:
        return None
    return cleaned


def _validate_setting_value(field: CatalogSettingField, value: object) -> None:
    if field.kind == "boolean":
        if not isinstance(value, bool):
            raise CatalogConfigurationError(f"'{field.id}' must be true or false.")
        return
    if not isinstance(value, str):
        raise CatalogConfigurationError(f"'{field.id}' must be a string.")
    if field.required and not value:
        raise CatalogConfigurationError(f"'{field.id}' is required.")
    if field.kind == "select":
        allowed = {option.value for option in field.options}
        if value not in allowed:
            raise CatalogConfigurationError(f"'{field.id}' must be one of: {', '.join(allowed)}.")
    if field.kind == "url" and value:
        _validate_https_url(value)


def _render_launch_url(
    source: StaticUrl | UrlBySetting,
    settings: dict[str, object],
) -> str:
    if isinstance(source, StaticUrl):
        return source.value
    selected = settings.get(source.setting_id)
    if not isinstance(selected, str):
        raise CatalogConfigurationError(f"Missing URL setting '{source.setting_id}'.")
    variants = {variant.value: variant.url for variant in source.variants}
    rendered = variants.get(selected)
    if rendered is None:
        raise CatalogConfigurationError(f"Unsupported URL setting '{source.setting_id}'.")
    return rendered


def _append_query_templates(
    url: str,
    templates: tuple[QueryTemplate, ...],
    settings: dict[str, object],
    secrets: dict[str, str],
) -> str:
    if not templates:
        return url
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for template in templates:
        rendered = _render_template_value(
            template.value,
            settings,
            secrets,
            optional=template.optional,
        )
        if rendered is None:
            continue
        query[template.name] = rendered
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            urlencode(query),
            parsed.fragment,
        )
    )


def _render_template_value(
    template: str,
    settings: dict[str, object],
    secrets: dict[str, str],
    *,
    optional: bool,
) -> str | None:
    missing = False

    def replace(match: re.Match[str]) -> str:
        nonlocal missing
        source = match.group(1)
        key = match.group(2)
        if source == "settings":
            if key not in settings:
                missing = True
                return ""
            return _stringify_template_value(settings[key])
        if key not in secrets:
            missing = True
            return ""
        return secrets[key]

    rendered = _PLACEHOLDER_RE.sub(replace, template)
    if "{" in rendered or "}" in rendered:
        raise CatalogConfigurationError("Unsupported template placeholder.")
    if missing or (optional and rendered == ""):
        if optional:
            return None
        raise CatalogConfigurationError("Required template value was missing.")
    return rendered


def _stringify_template_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _validate_https_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme == "https" and parsed.netloc:
        return
    raise CatalogConfigurationError("MCP launch URL must use https.")


def _validate_launch_url(
    value: str,
    *,
    entry: CatalogEntry,
    launch_context: LaunchUrlContext,
) -> None:
    parsed = urlparse(value)
    if parsed.scheme == "https" and parsed.netloc:
        return
    # Localhost launch URLs are only valid when materializing a local-only
    # connector into the desktop runtime; catalog, cloud, and OAuth paths stay
    # on public HTTPS endpoints.
    if (
        launch_context == "local_materialization"
        and entry.http is not None
        and entry.availability == "local_only"
        and entry.auth_kind != "oauth"
        and parsed.scheme == "http"
        and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        return
    raise CatalogConfigurationError("MCP launch URL must use https.")
