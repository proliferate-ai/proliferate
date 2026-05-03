from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import NoReturn, cast
from urllib.parse import urlparse
from uuid import UUID

from proliferate.db.store.cloud_mcp.custom_definitions import (
    create_custom_definition,
    get_custom_definition,
    list_custom_definitions,
    soft_delete_custom_definition,
    update_custom_definition,
)
from proliferate.db.store.cloud_mcp.types import CloudMcpCustomDefinitionRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.catalog import (
    ArgTemplate,
    CatalogEntry,
    CatalogSecretField,
    EnvTemplate,
    HeaderTemplate,
    HttpLaunchTemplate,
    QueryTemplate,
    StaticUrl,
    get_catalog_entry,
)
from proliferate.server.cloud.mcp_catalog.types import ConnectorAuthKind, ConnectorAvailability
from proliferate.server.cloud.mcp_custom_definitions.models import (
    CreateCustomMcpDefinitionRequest,
    CustomMcpDefinitionsResponse,
    CustomMcpDefinitionSummaryModel,
    CustomMcpHttpTemplateModel,
    CustomMcpSecretFieldModel,
    CustomMcpStdioEnvTemplateModel,
    CustomMcpStdioTemplateModel,
    PatchCustomMcpDefinitionRequest,
    custom_definition_payload,
)

_PUBLIC_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,255}$")
_SERVER_NAME_CHARS = re.compile(r"[^a-z0-9]+")
_EDGE_UNDERSCORES = re.compile(r"^_+|_+$")
_PLACEHOLDER_RE = re.compile(r"\{secret\.([A-Za-z0-9_.:-]+)\}")
_CRLF_RE = re.compile(r"[\r\n]")
_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SHELL_META_RE = re.compile(r"[;&|`$<>]")
_MAX_NAME_LENGTH = 80
_MAX_DESCRIPTION_LENGTH = 300


@dataclass(frozen=True)
class CustomMcpDefinitionTemplate:
    http: CustomMcpHttpTemplateModel | None
    stdio: CustomMcpStdioTemplateModel | None
    secret_fields: tuple[CatalogSecretField, ...]


def _invalid_payload(message: str) -> NoReturn:
    raise CloudApiError("invalid_payload", message, status_code=400)


def _not_found() -> NoReturn:
    raise CloudApiError("not_found", "Custom MCP definition was not found.", status_code=404)


def _normalize_name(value: str) -> str:
    name = value.strip()
    if not name:
        _invalid_payload("Custom MCP definition name is required.")
    return name[:_MAX_NAME_LENGTH]


def _normalize_description(value: str) -> str:
    return value.strip()[:_MAX_DESCRIPTION_LENGTH]


def _default_definition_id(name: str) -> str:
    normalized = _SERVER_NAME_CHARS.sub("_", name.strip().lower())
    normalized = _EDGE_UNDERSCORES.sub("", normalized)
    return (normalized or "custom_mcp")[:80]


def _validate_definition_id_format(definition_id: str) -> str:
    cleaned = definition_id.strip()
    if not _PUBLIC_ID_RE.fullmatch(cleaned):
        _invalid_payload("Custom MCP definition id must be 1-255 URL-safe characters.")
    if cleaned.startswith("custom:"):
        _invalid_payload("Custom MCP definition id is reserved.")
    return cleaned


def _validate_new_definition_id(definition_id: str) -> str:
    cleaned = _validate_definition_id_format(definition_id)
    if get_catalog_entry(cleaned) is not None:
        _invalid_payload("Custom MCP definition id is reserved.")
    return cleaned


def _catalog_secret_field(field: CustomMcpSecretFieldModel) -> CatalogSecretField:
    field_id = field.id.strip()
    if not _PUBLIC_ID_RE.fullmatch(field_id):
        _invalid_payload("Secret field ids must be 1-255 URL-safe characters.")
    return CatalogSecretField(
        id=field_id,
        label=(field.label.strip() or field_id)[:80],
        placeholder=field.placeholder.strip()[:120],
        helper_text=field.helper_text.strip()[:200],
        get_token_instructions=field.get_token_instructions.strip()[:300],
        prefix_hint=field.prefix_hint.strip()[:40] if field.prefix_hint else None,
    )


def _secret_fields(fields: list[CustomMcpSecretFieldModel]) -> tuple[CatalogSecretField, ...]:
    converted = tuple(_catalog_secret_field(field) for field in fields)
    ids = [field.id for field in converted]
    if len(ids) != len(set(ids)):
        _invalid_payload("Secret field ids must be unique.")
    return converted


def _validate_value_template(
    value: str,
    *,
    secret_field_ids: set[str],
    auth_kind: str,
) -> str:
    template = value.strip()
    if _CRLF_RE.search(template):
        _invalid_payload("Template values cannot contain line breaks.")
    referenced = set(_PLACEHOLDER_RE.findall(template))
    if "{" in _PLACEHOLDER_RE.sub("", template) or "}" in _PLACEHOLDER_RE.sub("", template):
        _invalid_payload("Template values only support {secret.<field>} placeholders.")
    if referenced and auth_kind == "none":
        _invalid_payload("No-auth custom MCP definitions cannot reference secrets.")
    unknown = sorted(referenced - secret_field_ids)
    if unknown:
        _invalid_payload(f"Unknown secret fields in template: {', '.join(unknown)}.")
    return template


def _validate_http_url(url: str, *, availability: str) -> str:
    cleaned = url.strip()
    if _CRLF_RE.search(cleaned):
        _invalid_payload("HTTP MCP URL cannot contain line breaks.")
    parsed = urlparse(cleaned)
    if parsed.username or parsed.password:
        _invalid_payload("HTTP MCP URLs cannot contain credentials.")
    if parsed.fragment:
        _invalid_payload("HTTP MCP URLs cannot contain fragments.")
    if not parsed.hostname:
        _invalid_payload("HTTP MCP URL requires a host.")
    if parsed.scheme == "https":
        return cleaned
    if (
        availability == "local_only"
        and parsed.scheme == "http"
        and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        return cleaned
    _invalid_payload("HTTP MCP URL must use https unless it is local-only loopback HTTP.")


def _validate_name(value: str, kind: str) -> str:
    cleaned = value.strip()
    if not cleaned or _CRLF_RE.search(cleaned):
        _invalid_payload(f"{kind} names cannot be blank or contain line breaks.")
    return cleaned[:120]


def _validate_stdio_command(value: str) -> str:
    command = value.strip()
    if not command or _CRLF_RE.search(command) or _SHELL_META_RE.search(command):
        _invalid_payload("Stdio command must be a single command name/path, not a shell string.")
    return command


def _validate_stdio_arg(value: str) -> str:
    arg = value.strip()
    if _CRLF_RE.search(arg):
        _invalid_payload("Stdio args cannot contain line breaks.")
    return arg


def _validate_stdio_env_template(
    value: str,
    *,
    secret_field_ids: set[str],
    auth_kind: str,
) -> str:
    template = _validate_value_template(
        value,
        secret_field_ids=secret_field_ids,
        auth_kind=auth_kind,
    )
    if _PLACEHOLDER_RE.search(template) and _PLACEHOLDER_RE.fullmatch(template) is None:
        _invalid_payload("Stdio secret templates must be exactly {secret.<field>}.")
    return template


def _template_payload(
    *,
    transport: str,
    auth_kind: str,
    availability: str,
    http: CustomMcpHttpTemplateModel | None,
    stdio: CustomMcpStdioTemplateModel | None,
    secret_fields: tuple[CatalogSecretField, ...],
) -> str:
    secret_ids = {field.id for field in secret_fields}
    if auth_kind == "secret" and not secret_fields:
        _invalid_payload("API-key custom MCP definitions require at least one secret field.")
    if auth_kind == "none" and secret_fields:
        _invalid_payload("No-auth custom MCP definitions cannot declare secret fields.")
    if transport == "http":
        if http is None or stdio is not None:
            _invalid_payload("HTTP custom MCP definitions require only an HTTP template.")
        payload = {
            "http": {
                "url": _validate_http_url(http.url, availability=availability),
                "headers": [
                    {
                        "name": _validate_name(header.name, "Header"),
                        "valueTemplate": _validate_value_template(
                            header.value_template,
                            secret_field_ids=secret_ids,
                            auth_kind=auth_kind,
                        ),
                    }
                    for header in http.headers
                ],
                "query": [
                    {
                        "name": _validate_name(query.name, "Query"),
                        "valueTemplate": _validate_value_template(
                            query.value_template,
                            secret_field_ids=secret_ids,
                            auth_kind=auth_kind,
                        ),
                    }
                    for query in http.query
                ],
            },
            "secretFields": [_secret_field_payload(field) for field in secret_fields],
        }
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)
    if stdio is None or http is not None:
        _invalid_payload("Stdio custom MCP definitions require only a stdio template.")
    if availability != "local_only":
        _invalid_payload("Custom stdio MCP definitions must be local-only.")
    payload = {
        "stdio": {
            "command": _validate_stdio_command(stdio.command),
            "args": [_validate_stdio_arg(arg) for arg in stdio.args],
            "env": [
                {
                    "name": _validate_env_name(env.name),
                    "valueTemplate": _validate_stdio_env_template(
                        env.value_template,
                        secret_field_ids=secret_ids,
                        auth_kind=auth_kind,
                    ),
                }
                for env in stdio.env
            ],
        },
        "secretFields": [_secret_field_payload(field) for field in secret_fields],
    }
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _validate_env_name(value: str) -> str:
    cleaned = value.strip()
    if not _ENV_NAME_RE.fullmatch(cleaned):
        _invalid_payload("Environment variable names must be valid identifiers.")
    return cleaned


def _stdio_env_template(env: CustomMcpStdioEnvTemplateModel) -> EnvTemplate:
    match = _PLACEHOLDER_RE.fullmatch(env.value_template)
    return EnvTemplate(
        name=env.name,
        kind="secret" if match else "static",
        value=None if match else env.value_template,
        field_id=match.group(1) if match else None,
    )


def _secret_field_payload(field: CatalogSecretField) -> dict[str, str | None]:
    return {
        "id": field.id,
        "label": field.label,
        "placeholder": field.placeholder,
        "helperText": field.helper_text,
        "getTokenInstructions": field.get_token_instructions,
        "prefixHint": field.prefix_hint,
    }


def _template_from_record(record: CloudMcpCustomDefinitionRecord) -> CustomMcpDefinitionTemplate:
    try:
        payload = json.loads(record.template_json)
    except Exception as exc:
        raise ValueError("Invalid custom MCP template JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError("Invalid custom MCP template JSON.")
    secret_fields = tuple(
        CatalogSecretField(
            id=str(field.get("id", "")),
            label=str(field.get("label", "")),
            placeholder=str(field.get("placeholder", "")),
            helper_text=str(field.get("helperText", "")),
            get_token_instructions=str(field.get("getTokenInstructions", "")),
            prefix_hint=(
                str(field.get("prefixHint")) if field.get("prefixHint") is not None else None
            ),
        )
        for field in cast(list[dict[str, object]], payload.get("secretFields", []))
        if isinstance(field, dict)
    )
    http_payload = payload.get("http")
    stdio_payload = payload.get("stdio")
    http = (
        CustomMcpHttpTemplateModel.model_validate(http_payload)
        if isinstance(http_payload, dict)
        else None
    )
    stdio = (
        CustomMcpStdioTemplateModel.model_validate(stdio_payload)
        if isinstance(stdio_payload, dict)
        else None
    )
    return CustomMcpDefinitionTemplate(http=http, stdio=stdio, secret_fields=secret_fields)


def custom_definition_to_catalog_entry(record: CloudMcpCustomDefinitionRecord) -> CatalogEntry:
    template = _template_from_record(record)
    if record.transport == "http":
        if template.http is None:
            raise ValueError("Custom HTTP definition is missing an HTTP template.")
        return CatalogEntry(
            id=f"custom:{record.definition_id}",
            version=record.version,
            name=record.name,
            one_liner=record.description or f"Custom MCP server: {record.name}",
            description=record.description,
            docs_url="",
            availability=cast(ConnectorAvailability, record.availability),
            transport="http",
            auth_kind=cast(ConnectorAuthKind, record.auth_kind),
            http=HttpLaunchTemplate(
                url=StaticUrl(template.http.url),
                display_url=template.http.url,
                headers=tuple(
                    HeaderTemplate(header.name, header.value_template)
                    for header in template.http.headers
                ),
                query=tuple(
                    QueryTemplate(query.name, query.value_template)
                    for query in template.http.query
                ),
            ),
            server_name_base=record.definition_id,
            icon_id="custom",
            secret_fields=template.secret_fields,
            capabilities=("Custom HTTP MCP server",),
        )
    if template.stdio is None:
        raise ValueError("Custom stdio definition is missing a stdio template.")
    return CatalogEntry(
        id=f"custom:{record.definition_id}",
        version=record.version,
        name=record.name,
        one_liner=record.description or f"Custom MCP server: {record.name}",
        description=record.description,
        docs_url="",
        availability="local_only",
        transport="stdio",
        auth_kind=cast(ConnectorAuthKind, record.auth_kind),
        command=template.stdio.command,
        args=tuple(
            # Custom v1 intentionally keeps args literal and secrets env-only.
            ArgTemplate(kind="static", value=arg)
            for arg in template.stdio.args
        ),
        env=tuple(_stdio_env_template(env) for env in template.stdio.env),
        server_name_base=record.definition_id,
        icon_id="custom",
        secret_fields=template.secret_fields,
        capabilities=("Custom stdio MCP server",),
    )


def custom_definition_summary(
    record: CloudMcpCustomDefinitionRecord,
) -> CustomMcpDefinitionSummaryModel:
    entry = custom_definition_to_catalog_entry(record)
    return custom_definition_payload(
        record,
        display_url=entry.display_url,
        server_name_base=entry.server_name_base,
        icon_id=entry.icon_id,
        secret_fields=[
            CustomMcpSecretFieldModel(
                id=field.id,
                label=field.label,
                placeholder=field.placeholder,
                helper_text=field.helper_text,
                get_token_instructions=field.get_token_instructions,
                prefix_hint=field.prefix_hint,
            )
            for field in entry.secret_fields
        ],
    )


async def list_custom_mcp_definitions(user_id: UUID) -> CustomMcpDefinitionsResponse:
    records = await list_custom_definitions(user_id, include_deleted=True)
    return CustomMcpDefinitionsResponse(
        definitions=[custom_definition_summary(record) for record in records]
    )


async def create_custom_mcp_definition(
    user_id: UUID,
    body: CreateCustomMcpDefinitionRequest,
) -> CustomMcpDefinitionSummaryModel:
    name = _normalize_name(body.name)
    definition_id = _validate_new_definition_id(body.definition_id or _default_definition_id(name))
    if await get_custom_definition(user_id, definition_id) is not None:
        _invalid_payload("Custom MCP definition already exists.")
    availability = "local_only" if body.transport == "stdio" else body.availability
    secret_fields = _secret_fields(body.secret_fields)
    template_json = _template_payload(
        transport=body.transport,
        auth_kind=body.auth_kind,
        availability=availability,
        http=body.http,
        stdio=body.stdio,
        secret_fields=secret_fields,
    )
    record = await create_custom_definition(
        user_id=user_id,
        definition_id=definition_id,
        name=name,
        description=_normalize_description(body.description),
        transport=body.transport,
        auth_kind=body.auth_kind,
        availability=availability,
        template_json=template_json,
        enabled=body.enabled,
    )
    return custom_definition_summary(record)


async def patch_custom_mcp_definition(
    user_id: UUID,
    definition_id: str,
    body: PatchCustomMcpDefinitionRequest,
) -> CustomMcpDefinitionSummaryModel:
    record = await get_custom_definition(user_id, _validate_definition_id_format(definition_id))
    if record is None:
        _not_found()
    transport = body.transport or record.transport
    auth_kind = body.auth_kind or record.auth_kind
    availability = (
        "local_only"
        if transport == "stdio"
        else (body.availability or record.availability)
    )
    current_template = _template_from_record(record)
    secret_fields = (
        _secret_fields(body.secret_fields)
        if body.secret_fields is not None
        else current_template.secret_fields
    )
    template_json = _template_payload(
        transport=transport,
        auth_kind=auth_kind,
        availability=availability,
        http=body.http if body.http is not None else current_template.http,
        stdio=body.stdio if body.stdio is not None else current_template.stdio,
        secret_fields=secret_fields,
    )
    updated = await update_custom_definition(
        user_id=user_id,
        definition_id=record.definition_id,
        name=_normalize_name(body.name) if body.name is not None else None,
        description=(
            _normalize_description(body.description) if body.description is not None else None
        ),
        transport=transport,
        auth_kind=auth_kind,
        availability=availability,
        template_json=template_json,
        enabled=body.enabled,
    )
    if updated is None:
        _not_found()
    return custom_definition_summary(updated)


async def delete_custom_mcp_definition(user_id: UUID, definition_id: str) -> None:
    deleted = await soft_delete_custom_definition(
        user_id,
        _validate_definition_id_format(definition_id),
    )
    if deleted is None:
        _not_found()
