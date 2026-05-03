from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from proliferate.db.store.cloud_mcp.types import (
    CloudMcpAuthRecord,
    CloudMcpConnectionRecord,
    CloudMcpCustomDefinitionRecord,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.catalog import (
    CatalogEntry,
    CatalogSecretField,
    HttpLaunchTemplate,
    StaticUrl,
)
from proliferate.server.cloud.mcp_connections import service
from proliferate.server.cloud.mcp_connections.models import CreateCloudMcpConnectionRequest
from proliferate.utils.crypto import encrypt_json


def _custom_definition_record(
    *,
    user_id: UUID,
    enabled: bool,
) -> CloudMcpCustomDefinitionRecord:
    now = datetime.now(UTC)
    return CloudMcpCustomDefinitionRecord(
        id=uuid4(),
        user_id=user_id,
        definition_id="custom_http",
        version=1,
        name="Custom HTTP",
        description="",
        transport="http",
        auth_kind="none",
        availability="universal",
        template_json=json.dumps(
            {
                "http": {"url": "https://example.com/mcp", "headers": [], "query": []},
                "secretFields": [],
            }
        ),
        enabled=enabled,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )


def _connection_record(auth: CloudMcpAuthRecord | None) -> CloudMcpConnectionRecord:
    now = datetime.now(UTC)
    return CloudMcpConnectionRecord(
        id=uuid4(),
        user_id=uuid4(),
        org_id=None,
        connection_id="conn_custom",
        catalog_entry_id=None,
        catalog_entry_version=1,
        server_name="custom",
        enabled=True,
        settings_json="{}",
        config_version=1,
        payload_ciphertext=None,
        payload_format="json-v1",
        created_at=now,
        updated_at=now,
        last_synced_at=now,
        auth=auth,
        custom_definition_db_id=uuid4(),
    )


def _auth_record(
    *,
    auth_kind: str,
    auth_status: str = "ready",
    secret_fields: dict[str, str] | None = None,
) -> CloudMcpAuthRecord:
    now = datetime.now(UTC)
    return CloudMcpAuthRecord(
        id=uuid4(),
        connection_db_id=uuid4(),
        auth_kind=auth_kind,
        auth_status=auth_status,
        payload_ciphertext=(
            encrypt_json({"secretFields": secret_fields}) if secret_fields is not None else None
        ),
        payload_format="secret-fields-v1" if secret_fields is not None else "json-v1",
        auth_version=1,
        token_expires_at=None,
        last_error_code=None,
        created_at=now,
        updated_at=now,
    )


def _secret_entry() -> CatalogEntry:
    return CatalogEntry(
        id="custom:secret_http",
        version=2,
        name="Secret HTTP",
        one_liner="Secret",
        description="Secret",
        docs_url="",
        availability="universal",
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://example.com/mcp"),
            display_url="https://example.com/mcp",
        ),
        server_name_base="secret_http",
        icon_id="custom",
        secret_fields=(
            CatalogSecretField(
                id="api_key",
                label="API key",
                placeholder="",
                helper_text="",
                get_token_instructions="",
            ),
        ),
        capabilities=(),
    )


def _no_auth_entry() -> CatalogEntry:
    return CatalogEntry(
        id="custom:no_auth_http",
        version=2,
        name="No Auth HTTP",
        one_liner="No auth",
        description="No auth",
        docs_url="",
        availability="universal",
        transport="http",
        auth_kind="none",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://example.com/mcp"),
            display_url="https://example.com/mcp",
        ),
        server_name_base="no_auth_http",
        icon_id="custom",
        capabilities=(),
    )


def test_generate_server_name_uses_unique_counter_for_base_collisions() -> None:
    entry = CatalogEntry(
        id="custom:foo_1",
        version=1,
        name="Foo",
        one_liner="Foo",
        description="Foo",
        docs_url="",
        availability="universal",
        transport="http",
        auth_kind="none",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://example.com/mcp"),
            display_url="https://example.com/mcp",
        ),
        server_name_base="foo:1",
        icon_id="custom",
        capabilities=(),
    )

    assert service._generate_server_name(entry, {"foo_1"}) == "foo_1_2"
    assert service._generate_server_name(entry, {"foo_1", "foo_1_2"}) == "foo_1_3"


@pytest.mark.asyncio
async def test_create_custom_connection_rejects_disabled_definition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()

    async def _get_custom_definition(
        _user_id: UUID,
        _definition_id: str,
    ) -> CloudMcpCustomDefinitionRecord:
        return _custom_definition_record(user_id=user_id, enabled=False)

    monkeypatch.setattr(service, "get_custom_definition", _get_custom_definition)

    with pytest.raises(CloudApiError) as exc_info:
        await service.create_cloud_mcp_connection(
            user_id,
            CreateCloudMcpConnectionRequest(
                targetKind="custom",
                customDefinitionId="custom_http",
            ),
        )

    assert exc_info.value.code == "invalid_payload"


def test_auth_state_needs_reconnect_when_definition_auth_kind_changes_to_secret() -> None:
    auth = _auth_record(auth_kind="none")
    record = _connection_record(auth)

    assert service._auth_state(record, _secret_entry()) == ("secret", "needs_reconnect")


def test_auth_state_needs_reconnect_when_secret_definition_adds_required_field() -> None:
    auth = _auth_record(auth_kind="secret", secret_fields={})
    record = _connection_record(auth)

    assert service._auth_state(record, _secret_entry()) == ("secret", "needs_reconnect")


def test_auth_state_ready_when_secret_payload_matches_current_definition() -> None:
    auth = _auth_record(auth_kind="secret", secret_fields={"api_key": "token"})
    record = _connection_record(auth)

    assert service._auth_state(record, _secret_entry()) == ("secret", "ready")


def test_auth_state_ready_when_definition_auth_kind_changes_to_none() -> None:
    auth = _auth_record(auth_kind="secret", secret_fields={"api_key": "token"})
    record = _connection_record(auth)

    assert service._auth_state(record, _no_auth_entry()) == ("none", "ready")
