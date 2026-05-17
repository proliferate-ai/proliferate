"""Pure-ish runtime config manifest assembly for cloud target configs.

The service layer provides already-loaded catalog/plugin/MCP data. This module
flattens that data into AnyHarness's redacted runtime manifest plus bounded
fulfillment payloads for artifacts and credentials.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qsl, urlsplit, urlunsplit
from uuid import UUID, uuid4

from proliferate.server.cloud.mcp_materialization.models import (
    MaterializeCloudMcpResponse,
    SessionMcpHttpServerModel,
)
from proliferate.server.cloud.plugins.catalog.models import (
    PluginPackageModel,
    PluginPackageSkillModel,
    PluginSkillResourceModel,
)

_ARTIFACT_PREFETCH_MAX_BYTES = 2 * 1024 * 1024


def build_target_runtime_config(
    *,
    target_id: UUID,
    target_config_id: UUID,
    config_version: int,
    owner_scope: str,
    mcp: MaterializeCloudMcpResponse,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    revision_id = str(uuid4())
    artifact_payloads: list[dict[str, Any]] = []
    credential_payloads: list[dict[str, Any]] = []
    mcp_servers = [
        _runtime_http_server(server, credential_payloads)
        for server in mcp.mcp_servers
        if isinstance(server, SessionMcpHttpServerModel)
    ]
    skills = [
        _runtime_skill(package, skill, artifact_payloads)
        for package in mcp.plugin_packages
        for skill in package.skills
        if skill.default_enabled
    ]
    warnings = [warning.model_dump(mode="json", by_alias=True) for warning in mcp.warnings]
    manifest: dict[str, Any] = {
        "revision": {
            "id": revision_id,
            "sequence": config_version,
            "generatedAt": datetime.now(UTC).isoformat(),
            "contentHash": "",
            "ownerScope": owner_scope,
            "externalTargetId": str(target_id),
        },
        "mcpServers": mcp_servers,
        "mcpBindingSummaries": [
            summary.model_dump(mode="json", by_alias=True)
            for summary in mcp.mcp_binding_summaries
        ],
        "skills": skills,
        "artifacts": [],
        "source": "worker",
    }
    content_hash = hashlib.sha256(
        json.dumps(
            {**manifest, "revision": {**manifest["revision"], "contentHash": ""}},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    manifest["revision"]["contentHash"] = content_hash
    for payload in artifact_payloads:
        payload["revisionId"] = revision_id
        payload["targetConfigId"] = str(target_config_id)
    return manifest, artifact_payloads, credential_payloads, warnings


def _runtime_http_server(
    server: SessionMcpHttpServerModel,
    credential_payloads: list[dict[str, Any]],
) -> dict[str, Any]:
    base_url, query = _split_query(server.url)
    credential_refs: list[dict[str, Any]] = []
    headers = []
    for index, header in enumerate(server.headers):
        value, credential = _template_for_sensitive_value(
            value=header.value,
            connection_id=server.connection_id,
            catalog_entry_id=server.catalog_entry_id,
            catalog_entry_version=None,
            field_id=f"header:{header.name.lower()}:{index}",
            auth_version=None,
            display_name=header.name,
            force_sensitive=header.name.lower() == "authorization",
            credential_payloads=credential_payloads,
        )
        if credential is not None:
            credential_refs.append(credential)
        headers.append({"name": header.name, "value": value})
    rendered_query = []
    for index, (name, value) in enumerate(query):
        templated, credential = _template_for_sensitive_value(
            value=value,
            connection_id=server.connection_id,
            catalog_entry_id=server.catalog_entry_id,
            catalog_entry_version=None,
            field_id=f"query:{name}:{index}",
            auth_version=None,
            display_name=name,
            force_sensitive=_looks_sensitive_name(name),
            credential_payloads=credential_payloads,
        )
        if credential is not None:
            credential_refs.append(credential)
        rendered_query.append({"name": name, "value": templated})
    return {
        "id": f"{server.connection_id}:{server.server_name}",
        "connectionId": server.connection_id,
        "catalogEntryId": server.catalog_entry_id,
        "serverName": server.server_name,
        "launch": {
            "transport": "http",
            "baseUrl": base_url,
            "query": rendered_query,
            "headers": headers,
        },
        "credentialRefs": credential_refs,
    }


def _template_for_sensitive_value(
    *,
    value: str,
    connection_id: str,
    catalog_entry_id: str | None,
    catalog_entry_version: int | None,
    field_id: str,
    auth_version: int | None,
    display_name: str,
    force_sensitive: bool,
    credential_payloads: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if not force_sensitive and not _looks_sensitive_value(value):
        return {"parts": [{"kind": "literal", "value": value}]}, None
    credential_ref = f"{connection_id}:{field_id}"
    prefix = ""
    secret_value = value
    if value.lower().startswith("bearer "):
        prefix = value[:7]
        secret_value = value[7:]
    credential = {
        "ref": credential_ref,
        "kind": (
            "oauth_access_token"
            if display_name.lower() == "authorization"
            else "secret_field"
        ),
        "connectionId": connection_id,
        "catalogEntryId": catalog_entry_id,
        "fieldId": field_id,
        "authVersion": auth_version,
        "catalogEntryVersion": catalog_entry_version,
        "displayName": display_name,
    }
    credential_payloads.append(
        {
            "ref": credential_ref,
            "value": secret_value,
            "redactedSummary": f"{display_name}: ready",
        }
    )
    parts = []
    if prefix:
        parts.append({"kind": "literal", "value": prefix})
    parts.append({"kind": "credential", "ref": credential_ref})
    return {"parts": parts}, credential


def _runtime_skill(
    package: PluginPackageModel,
    skill: PluginPackageSkillModel,
    artifact_payloads: list[dict[str, Any]],
) -> dict[str, Any]:
    instruction_artifact = _artifact_ref(
        content=skill.instructions,
        content_type="text/markdown",
        kind="skill_instruction",
        source_ref=f"{package.id}:{skill.id}:instructions",
        artifact_payloads=artifact_payloads,
    )
    return {
        "id": skill.id,
        "packageId": package.id,
        "version": package.version,
        "displayName": skill.display_name,
        "description": skill.description,
        "instructionArtifact": instruction_artifact,
        "resources": [
            _runtime_skill_resource(resource, artifact_payloads)
            for resource in skill.resources
        ],
        "requiredMcpServerIds": list(skill.required_mcp_server_refs),
        "credentialRefs": [],
    }


def _runtime_skill_resource(
    resource: PluginSkillResourceModel,
    artifact_payloads: list[dict[str, Any]],
) -> dict[str, Any]:
    artifact = _artifact_ref(
        content=resource.content,
        content_type=resource.content_type,
        kind="skill_resource",
        source_ref=resource.resource_id,
        artifact_payloads=artifact_payloads,
    )
    return {
        "resourceId": resource.resource_id,
        "displayName": resource.display_name,
        "artifact": artifact,
    }


def _artifact_ref(
    *,
    content: str,
    content_type: str,
    kind: str,
    source_ref: str,
    artifact_payloads: list[dict[str, Any]],
) -> dict[str, Any]:
    data = content.encode("utf-8")
    digest = hashlib.sha256(data).hexdigest()
    ref = {
        "hash": digest,
        "contentType": content_type,
        "byteSize": len(data),
        "kind": kind,
        "sourceRef": source_ref,
    }
    if len(data) <= _ARTIFACT_PREFETCH_MAX_BYTES:
        artifact_payloads.append(
            {
                **ref,
                "contentBase64": base64.b64encode(data).decode("ascii"),
            }
        )
    return ref


def _split_query(url: str) -> tuple[str, list[tuple[str, str]]]:
    parsed = urlsplit(url)
    base_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", parsed.fragment))
    return base_url, parse_qsl(parsed.query, keep_blank_values=True)


def _looks_sensitive_name(value: str) -> bool:
    lower = value.lower()
    return "token" in lower or "secret" in lower or "key" in lower


def _looks_sensitive_value(value: str) -> bool:
    lower = value.lower()
    return lower.startswith("bearer ") or "api_key" in lower or "token=" in lower
