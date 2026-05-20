from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from proliferate.server.cloud.mcp_catalog.domain.rendering import parse_settings, validate_settings
from proliferate.server.cloud.mcp_catalog.domain.types import (
    ArgTemplate,
    EnvTemplate,
    HeaderTemplate,
    QueryTemplate,
    StaticUrl,
    UrlBySetting,
)
from proliferate.server.cloud.runtime_config.domain.resolver import (
    ResolvedArtifactRef,
    ResolvedRuntimeConfigPlan,
)

_PLACEHOLDER_RE = re.compile(r"\{(settings|secret)\.([A-Za-z0-9_.:-]+)\}")


@dataclass(frozen=True)
class CompiledRuntimeConfigManifest:
    manifest: dict[str, object]
    manifest_json: str
    content_hash: str
    warnings_json: str
    artifact_payloads: tuple[ResolvedArtifactRef, ...]


def compile_runtime_config_manifest(
    plan: ResolvedRuntimeConfigPlan,
    *,
    sandbox_profile_id: str,
) -> CompiledRuntimeConfigManifest:
    manifest_without_hash = {
        "runtimeConfigVersion": 1,
        "externalScope": {
            "provider": "proliferate-cloud",
            "id": sandbox_profile_id,
            "targetId": None,
        },
        "mcpServers": [_mcp_server_payload(server) for server in plan.mcp_servers],
        "mcpBindingSummaries": [
            {
                "id": binding.server_id,
                "serverName": binding.server_name,
                "displayName": binding.display_name,
                "transport": binding.transport,
                "outcome": "applied",
                "reason": None,
            }
            for binding in plan.mcp_binding_summaries
        ],
        "skills": [_skill_payload(skill) for skill in plan.skills],
        "artifacts": [_artifact_payload(artifact) for artifact in plan.artifacts],
        "warnings": [_warning_payload(warning) for warning in plan.warnings],
        "blockingErrors": [_warning_payload(blocker) for blocker in plan.blocking_errors],
        "sourceRowRefs": [
            {
                "sourceKind": source.source_kind,
                "sourceId": source.source_id,
                "ownerScope": source.owner_scope,
                "ownerUserId": source.owner_user_id,
                "organizationId": source.organization_id,
            }
            for source in plan.source_row_refs
        ],
    }
    hash_value = _content_hash(manifest_without_hash)
    manifest = {
        **manifest_without_hash,
        "contentHash": hash_value,
    }
    warnings_json = _canonical_json(
        {
            "warnings": manifest_without_hash["warnings"],
            "blockingErrors": manifest_without_hash["blockingErrors"],
        }
    )
    return CompiledRuntimeConfigManifest(
        manifest=manifest,
        manifest_json=_canonical_json(manifest),
        content_hash=hash_value,
        warnings_json=warnings_json,
        artifact_payloads=plan.artifacts,
    )


def _mcp_server_payload(server) -> dict[str, object]:  # noqa: ANN001
    entry = server.catalog_entry
    settings = validate_settings(entry, parse_settings(server.settings_json))
    credential_refs: list[dict[str, object]] = []
    launch: dict[str, object]
    if entry.transport == "http" and entry.http is not None:
        launch = {
            "kind": "http",
            "url": _mcp_value_literal(_render_launch_url(entry.http.url, settings)),
            "headers": [
                _header_payload(server, header, settings, credential_refs)
                for header in entry.http.headers
                if _template_has_value(header.value, settings, optional=header.optional)
            ],
            "query": [
                _query_payload(server, query, settings, credential_refs)
                for query in entry.http.query
                if _template_has_value(query.value, settings, optional=query.optional)
            ],
        }
        launch["url"] = _append_literal_query_values(launch["url"], launch["query"])
    else:
        launch = {
            "kind": "stdio",
            "command": _mcp_value_literal(entry.command),
            "args": [_arg_payload(server, arg, credential_refs) for arg in entry.args],
            "env": [_env_payload(server, env, settings, credential_refs) for env in entry.env],
        }
    return {
        "id": server.id,
        "connectionId": server.connection_id,
        "connectionDbId": server.connection_db_id,
        "catalogEntryId": server.catalog_entry_id,
        "catalogEntryVersion": server.catalog_entry_version,
        "serverName": server.server_name,
        "transport": entry.transport,
        "launch": launch,
        "credentialRefs": credential_refs,
    }


def _skill_payload(skill) -> dict[str, object]:  # noqa: ANN001
    return {
        "id": skill.id,
        "sourceKind": skill.source_kind,
        "pluginId": skill.plugin_id,
        "displayName": skill.display_name,
        "description": skill.description,
        "instructionArtifact": _artifact_payload(skill.instruction_artifact),
        "resources": [_artifact_payload(resource) for resource in skill.resources],
        "requiredMcpServerIds": list(skill.required_mcp_server_ids),
        "credentialRefs": list(skill.credential_refs),
    }


def _artifact_payload(artifact: ResolvedArtifactRef) -> dict[str, object]:
    return {
        "hash": artifact.hash,
        "contentType": artifact.content_type,
        "byteSize": artifact.byte_size,
        "sourceRef": artifact.source_ref,
    }


def _warning_payload(value) -> dict[str, object]:  # noqa: ANN001
    source = value.source
    return {
        "code": value.code,
        "message": value.message,
        "source": None
        if source is None
        else {
            "sourceKind": source.source_kind,
            "sourceId": source.source_id,
            "ownerScope": source.owner_scope,
            "ownerUserId": source.owner_user_id,
            "organizationId": source.organization_id,
        },
    }


def _header_payload(
    server,  # noqa: ANN001
    template: HeaderTemplate,
    settings: dict[str, object],
    credential_refs: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "name": template.name,
        "value": _template_value(
            server,
            template.value,
            settings,
            credential_refs,
            used_in="mcp_launch_header",
            field_name=template.name,
        ),
    }


def _query_payload(
    server,  # noqa: ANN001
    template: QueryTemplate,
    settings: dict[str, object],
    credential_refs: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "name": template.name,
        "value": _template_value(
            server,
            template.value,
            settings,
            credential_refs,
            used_in="mcp_launch_query",
            field_name=template.name,
        ),
    }


def _arg_payload(
    server,  # noqa: ANN001
    template: ArgTemplate,
    credential_refs: list[dict[str, object]],
) -> dict[str, object]:
    if template.kind == "secret":
        return _credential_value(
            server,
            credential_refs,
            used_in="mcp_launch_arg",
            field_name=template.field_id or "",
        )
    if template.kind == "setting":
        return _mcp_value_literal(f"{{settings.{template.field_id or ''}}}")
    if template.kind == "workspace_path":
        return _mcp_value_literal("${workspaceRoot}")
    return _mcp_value_literal(template.value or "")


def _env_payload(
    server,  # noqa: ANN001
    template: EnvTemplate,
    settings: dict[str, object],
    credential_refs: list[dict[str, object]],
) -> dict[str, object]:
    if template.kind == "secret":
        value = _credential_value(
            server,
            credential_refs,
            used_in="mcp_launch_env",
            field_name=template.field_id or template.name,
        )
    elif template.kind == "setting":
        value = _mcp_value_literal(str(settings.get(template.field_id or "", "")))
    else:
        value = _mcp_value_literal(template.value or "")
    return {"name": template.name, "value": value}


def _template_value(
    server,  # noqa: ANN001
    template: str,
    settings: dict[str, object],
    credential_refs: list[dict[str, object]],
    *,
    used_in: str,
    field_name: str,
) -> dict[str, object]:
    match = _PLACEHOLDER_RE.fullmatch(template)
    if match and match.group(1) == "secret":
        return _credential_value(
            server,
            credential_refs,
            used_in=used_in,
            field_name=match.group(2),
        )

    parts: list[dict[str, object]] = []
    cursor = 0
    for placeholder in _PLACEHOLDER_RE.finditer(template):
        if placeholder.start() > cursor:
            parts.append(_mcp_value_literal(template[cursor : placeholder.start()]))
        source = placeholder.group(1)
        field_id = placeholder.group(2)
        if source == "settings":
            parts.append(_mcp_value_literal(_stringify(settings[field_id])))
        else:
            parts.append(
                _credential_value(
                    server,
                    credential_refs,
                    used_in=used_in,
                    field_name=field_id,
                )
            )
        cursor = placeholder.end()
    if cursor < len(template):
        parts.append(_mcp_value_literal(template[cursor:]))
    if len(parts) == 1:
        return parts[0]
    return {"kind": "template", "parts": parts}


def _credential_value(
    server,  # noqa: ANN001
    credential_refs: list[dict[str, object]],
    *,
    used_in: str,
    field_name: str,
) -> dict[str, object]:
    credential_ref = f"mcp:{server.connection_db_id}:{field_name}"
    ref = {
        "credentialRef": credential_ref,
        "usedIn": used_in,
        "mcpServerId": server.id,
        "fieldName": field_name,
        "authKind": server.auth_kind,
        "authVersion": server.auth_version,
    }
    if ref not in credential_refs:
        credential_refs.append(ref)
    return {"kind": "credential", "credentialRef": credential_ref}


def _mcp_value_literal(value: str) -> dict[str, object]:
    return {"kind": "literal", "value": value}


def _render_launch_url(source: StaticUrl | UrlBySetting, settings: dict[str, object]) -> str:
    if isinstance(source, StaticUrl):
        return source.value
    selected = settings.get(source.setting_id)
    variants = {variant.value: variant.url for variant in source.variants}
    return variants[str(selected)]


def _append_literal_query_values(
    url_value: dict[str, object],
    query_values: object,
) -> dict[str, object]:
    if url_value.get("kind") != "literal" or not isinstance(query_values, list):
        return url_value
    query: dict[str, str] = {}
    dynamic_query: list[dict[str, object]] = []
    for item in query_values:
        if (
            isinstance(item, dict)
            and isinstance(item.get("name"), str)
            and isinstance(item.get("value"), dict)
            and item["value"].get("kind") == "literal"
        ):
            query[item["name"]] = str(item["value"].get("value", ""))
        elif isinstance(item, dict):
            dynamic_query.append(item)
    if not query:
        return url_value
    parsed = urlparse(str(url_value["value"]))
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing.update(query)
    return {
        "kind": "literal",
        "value": urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                urlencode(existing),
                parsed.fragment,
            )
        ),
        "dynamicQuery": dynamic_query,
    }


def _template_has_value(template: str, settings: dict[str, object], *, optional: bool) -> bool:
    missing = False
    for placeholder in _PLACEHOLDER_RE.finditer(template):
        if placeholder.group(1) == "settings" and placeholder.group(2) not in settings:
            missing = True
    return not missing or not optional


def _stringify(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _content_hash(value: dict[str, object]) -> str:
    import hashlib

    return f"sha256:{hashlib.sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
