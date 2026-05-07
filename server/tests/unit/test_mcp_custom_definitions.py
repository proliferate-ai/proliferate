from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from proliferate.db.store.cloud_mcp.types import CloudMcpCustomDefinitionRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_custom_definitions import service
from proliferate.server.cloud.mcp_custom_definitions.models import (
    CreateCustomMcpDefinitionRequest,
    CustomMcpHttpTemplateModel,
    CustomMcpSecretFieldModel,
    CustomMcpStdioTemplateModel,
    CustomMcpTemplateValueModel,
    PatchCustomMcpDefinitionRequest,
)


def _record(
    *,
    user_id: UUID,
    definition_id: str,
    transport: str,
    auth_kind: str,
    availability: str,
    template_json: str,
) -> CloudMcpCustomDefinitionRecord:
    now = datetime.now(UTC)
    return CloudMcpCustomDefinitionRecord(
        id=uuid4(),
        user_id=user_id,
        definition_id=definition_id,
        version=1,
        name="Custom MCP",
        description="",
        transport=transport,
        auth_kind=auth_kind,
        availability=availability,
        template_json=template_json,
        enabled=True,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_create_http_secret_definition_stores_template_metadata_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    captured: dict[str, object] = {}

    async def _get_custom_definition(
        _user_id: UUID,
        _definition_id: str,
    ) -> None:
        return None

    async def _create_custom_definition(
        *,
        user_id: UUID,
        definition_id: str,
        name: str,
        description: str,
        transport: str,
        auth_kind: str,
        availability: str,
        template_json: str,
        enabled: bool,
    ) -> CloudMcpCustomDefinitionRecord:
        captured.update(
            {
                "user_id": user_id,
                "definition_id": definition_id,
                "name": name,
                "description": description,
                "transport": transport,
                "auth_kind": auth_kind,
                "availability": availability,
                "template_json": template_json,
                "enabled": enabled,
            }
        )
        return _record(
            user_id=user_id,
            definition_id=definition_id,
            transport=transport,
            auth_kind=auth_kind,
            availability=availability,
            template_json=template_json,
        )

    monkeypatch.setattr(service, "get_custom_definition", _get_custom_definition)
    monkeypatch.setattr(service, "create_custom_definition", _create_custom_definition)

    summary = await service.create_custom_mcp_definition(
        user_id,
        CreateCustomMcpDefinitionRequest(
            definitionId="my_http",
            name="My HTTP",
            availability="universal",
            transport="http",
            authKind="secret",
            http=CustomMcpHttpTemplateModel(
                url="https://example.com/mcp",
                headers=[
                    CustomMcpTemplateValueModel(
                        name="Authorization",
                        value_template="Bearer {secret.api_key}",
                    )
                ],
                query=[],
            ),
            secretFields=[
                CustomMcpSecretFieldModel(
                    id="api_key",
                    label="API key",
                    helper_text="Stored on the connection.",
                    get_token_instructions="Create an API key.",
                )
            ],
        ),
    )

    template_json = captured["template_json"]
    assert isinstance(template_json, str)
    payload = json.loads(template_json)
    assert payload["http"]["headers"][0]["valueTemplate"] == "Bearer {secret.api_key}"
    assert "secret-value" not in template_json
    assert summary.definition_id == "my_http"
    assert summary.secret_fields[0].helper_text == "Stored on the connection."

    entry = service.custom_definition_to_catalog_entry(
        _record(
            user_id=user_id,
            definition_id="my_http",
            transport="http",
            auth_kind="secret",
            availability="universal",
            template_json=template_json,
        )
    )
    assert entry.id == "custom:my_http"
    assert entry.http is not None
    assert entry.http.headers[0].value == "Bearer {secret.api_key}"


@pytest.mark.asyncio
async def test_no_auth_definition_rejects_secret_placeholder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _get_custom_definition(
        _user_id: UUID,
        _definition_id: str,
    ) -> None:
        return None

    monkeypatch.setattr(service, "get_custom_definition", _get_custom_definition)

    with pytest.raises(CloudApiError) as exc_info:
        await service.create_custom_mcp_definition(
            uuid4(),
            CreateCustomMcpDefinitionRequest(
                definitionId="bad_http",
                name="Bad HTTP",
                transport="http",
                authKind="none",
                http=CustomMcpHttpTemplateModel(
                    url="https://example.com/mcp",
                    headers=[
                        CustomMcpTemplateValueModel(
                            name="Authorization",
                            value_template="Bearer {secret.api_key}",
                        )
                    ],
                    query=[],
                ),
            ),
        )

    assert exc_info.value.code == "invalid_payload"


@pytest.mark.asyncio
async def test_duplicate_secret_fields_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _get_custom_definition(
        _user_id: UUID,
        _definition_id: str,
    ) -> None:
        return None

    monkeypatch.setattr(service, "get_custom_definition", _get_custom_definition)

    with pytest.raises(CloudApiError) as exc_info:
        await service.create_custom_mcp_definition(
            uuid4(),
            CreateCustomMcpDefinitionRequest(
                definitionId="dupe",
                name="Dupe",
                transport="http",
                authKind="secret",
                http=CustomMcpHttpTemplateModel(url="https://example.com/mcp"),
                secretFields=[
                    CustomMcpSecretFieldModel(id="api_key", label="API key"),
                    CustomMcpSecretFieldModel(id="api_key", label="Second API key"),
                ],
            ),
        )

    assert exc_info.value.code == "invalid_payload"


@pytest.mark.asyncio
async def test_stdio_definition_rejects_shell_like_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _get_custom_definition(
        _user_id: UUID,
        _definition_id: str,
    ) -> None:
        return None

    monkeypatch.setattr(service, "get_custom_definition", _get_custom_definition)

    with pytest.raises(CloudApiError) as exc_info:
        await service.create_custom_mcp_definition(
            uuid4(),
            CreateCustomMcpDefinitionRequest(
                definitionId="bad_stdio",
                name="Bad stdio",
                availability="local_only",
                transport="stdio",
                authKind="none",
                stdio=CustomMcpStdioTemplateModel(command="npx package && rm -rf /"),
            ),
        )

    assert exc_info.value.code == "invalid_payload"


def test_custom_definition_to_catalog_entry_keeps_stdio_args_literal_and_env_secret_only() -> None:
    template_json = json.dumps(
        {
            "stdio": {
                "command": "npx",
                "args": ["-y", "@example/mcp"],
                "env": [{"name": "API_KEY", "valueTemplate": "{secret.api_key}"}],
            },
            "secretFields": [
                {
                    "id": "api_key",
                    "label": "API key",
                    "placeholder": "",
                    "helperText": "",
                    "getTokenInstructions": "",
                    "prefixHint": None,
                }
            ],
        }
    )

    entry = service.custom_definition_to_catalog_entry(
        _record(
            user_id=uuid4(),
            definition_id="stdio_custom",
            transport="stdio",
            auth_kind="secret",
            availability="local_only",
            template_json=template_json,
        )
    )

    assert entry.id == "custom:stdio_custom"
    assert entry.transport == "stdio"
    assert [arg.kind for arg in entry.args] == ["static", "static"]
    assert [(env.name, env.kind, env.field_id) for env in entry.env] == [
        ("API_KEY", "secret", "api_key")
    ]


@pytest.mark.asyncio
async def test_patch_allows_existing_definition_id_that_later_collides_with_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    record = _record(
        user_id=user_id,
        definition_id="future_curated",
        transport="http",
        auth_kind="none",
        availability="universal",
        template_json=json.dumps(
            {
                "http": {"url": "https://example.com/mcp", "headers": [], "query": []},
                "secretFields": [],
            }
        ),
    )

    async def _get_custom_definition(
        _user_id: UUID,
        _definition_id: str,
    ) -> CloudMcpCustomDefinitionRecord:
        return record

    async def _update_custom_definition(
        *,
        user_id: UUID,
        definition_id: str,
        name: str | None = None,
        description: str | None = None,
        transport: str | None = None,
        auth_kind: str | None = None,
        availability: str | None = None,
        template_json: str | None = None,
        enabled: bool | None = None,
    ) -> CloudMcpCustomDefinitionRecord:
        return _record(
            user_id=user_id,
            definition_id=definition_id,
            transport=transport or record.transport,
            auth_kind=auth_kind or record.auth_kind,
            availability=availability or record.availability,
            template_json=template_json or record.template_json,
        )

    monkeypatch.setattr(service, "get_catalog_entry", lambda _definition_id: object())
    monkeypatch.setattr(service, "get_custom_definition", _get_custom_definition)
    monkeypatch.setattr(service, "update_custom_definition", _update_custom_definition)

    summary = await service.patch_custom_mcp_definition(
        user_id,
        "future_curated",
        PatchCustomMcpDefinitionRequest(name="Updated"),
    )

    assert summary.definition_id == "future_curated"


@pytest.mark.asyncio
async def test_delete_allows_existing_definition_id_that_later_collides_with_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    record = _record(
        user_id=user_id,
        definition_id="future_curated",
        transport="http",
        auth_kind="none",
        availability="universal",
        template_json=json.dumps(
            {
                "http": {"url": "https://example.com/mcp", "headers": [], "query": []},
                "secretFields": [],
            }
        ),
    )

    async def _soft_delete_custom_definition(
        _user_id: UUID,
        _definition_id: str,
    ) -> CloudMcpCustomDefinitionRecord:
        return record

    monkeypatch.setattr(service, "get_catalog_entry", lambda _definition_id: object())
    monkeypatch.setattr(
        service,
        "soft_delete_custom_definition",
        _soft_delete_custom_definition,
    )

    await service.delete_custom_mcp_definition(user_id, "future_curated")
