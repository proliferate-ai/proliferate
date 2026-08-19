from __future__ import annotations

import asyncio
import uuid

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import temporary_database

_REVISION = "b32d45e67f89"
_DOWN_REVISION = "a21c34d56e78"


async def test_admission_revocation_schema_keeps_rolling_compatibility() -> None:
    async with temporary_database("int_admit_revoke") as (
        _name,
        database_url,
    ):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        engine = create_async_engine(database_url, echo=False)
        ids = {name: uuid.uuid4() for name in ("user", "definition", "account", "approval")}
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        'INSERT INTO "user" '
                        "(id, email, hashed_password, is_active, is_superuser, is_verified, "
                        "created_at) VALUES (:id, :email, 'x', true, false, true, now())"
                    ),
                    {"id": ids["user"], "email": f"pr3-{ids['user']}@example.com"},
                )
                await conn.execute(
                    text(
                        "INSERT INTO cloud_integration_definition "
                        "(id, source, namespace, display_name, auth_kind, config_json, "
                        "enabled_by_default, created_at, updated_at) VALUES "
                        "(:id, 'seed', 'pr3-migration', 'PR3 Migration', 'api_key', '{}', "
                        "true, now(), now())"
                    ),
                    {"id": ids["definition"]},
                )
                await conn.execute(
                    text(
                        "INSERT INTO cloud_integration_account "
                        "(id, definition_id, owner_user_id, owner_scope, enabled, status, "
                        "auth_kind, credential_format, auth_version, grant_version, "
                        "credential_version, settings_json, created_at, updated_at) VALUES "
                        "(:id, :definition, :owner, 'personal', true, 'ready', 'api_key', "
                        "'secret-fields-v1', 17, 17, 17, '{}', now(), now())"
                    ),
                    {
                        "id": ids["account"],
                        "definition": ids["definition"],
                        "owner": ids["user"],
                    },
                )
                await conn.execute(
                    text(
                        "INSERT INTO cloud_integration_tool_schema_cache "
                        "(account_id, auth_version, tools_json, status, created_at, updated_at) "
                        "VALUES (:account, 17, '[]', 'ready', now(), now())"
                    ),
                    {"account": ids["account"]},
                )
                await conn.execute(
                    text(
                        "INSERT INTO cloud_integration_action_approval "
                        "(id, owner_user_id, integration_account_id, "
                        "integration_account_auth_version, runtime_worker_id, "
                        "gateway_session_id, workspace_id, anyharness_session_id, "
                        "provider_namespace, tool_name, payload_digest, binding_digest, "
                        "idempotency_key, safe_action_summary, safe_account_label, "
                        "safe_source_label, status, expires_at, created_at, updated_at) VALUES "
                        "(:id, :owner, :account, 17, :worker, :session, 'workspace', "
                        "'harness-session', 'linear', 'create_issue', :payload, :binding, "
                        ":idempotency, 'Create issue', 'Linear connection', 'Test session', "
                        "'pending', now() + interval '10 minutes', now(), now())"
                    ),
                    {
                        "id": ids["approval"],
                        "owner": ids["user"],
                        "account": ids["account"],
                        "worker": uuid.uuid4(),
                        "session": uuid.uuid4(),
                        "payload": "a" * 64,
                        "binding": "b" * 64,
                        "idempotency": "c" * 64,
                    },
                )

            await asyncio.to_thread(command.upgrade, config, _REVISION)
            async with engine.begin() as conn:
                assert (
                    await conn.scalar(
                        text(
                            "SELECT auth_version FROM cloud_integration_tool_schema_cache "
                            "WHERE account_id = :account"
                        ),
                        {"account": ids["account"]},
                    )
                    == 17
                )
                assert (
                    await conn.scalar(
                        text(
                            "SELECT integration_account_auth_version "
                            "FROM cloud_integration_action_approval WHERE id = :approval"
                        ),
                        {"approval": ids["approval"]},
                    )
                    == 17
                )
                compatibility_columns = await conn.run_sync(
                    lambda sync_conn: {
                        "cache": {
                            column["name"]
                            for column in inspect(sync_conn).get_columns(
                                "cloud_integration_tool_schema_cache"
                            )
                        },
                        "approval": {
                            column["name"]
                            for column in inspect(sync_conn).get_columns(
                                "cloud_integration_action_approval"
                            )
                        },
                    }
                )
                assert "auth_version" in compatibility_columns["cache"]
                assert "grant_version" not in compatibility_columns["cache"]
                assert "integration_account_auth_version" in compatibility_columns["approval"]
                assert "integration_account_grant_version" not in compatibility_columns["approval"]
                flow_columns = await conn.run_sync(
                    lambda sync_conn: {
                        column["name"]
                        for column in inspect(sync_conn).get_columns(
                            "cloud_integration_oauth_flow"
                        )
                    }
                )
                assert "revocation_endpoint" in flow_columns
                await conn.execute(
                    text(
                        "INSERT INTO cloud_integration_revocation_job "
                        "(id, account_id, owner_user_id, definition_id, provider_namespace, "
                        "credential_ciphertext, credential_format, status, attempt_count, "
                        "deadline_at, created_at, updated_at) VALUES "
                        "(:id, :account, :owner, :definition, 'linear', 'encrypted', "
                        "'revocation-bundle-v1', 'pending', 0, now() + interval '1 day', "
                        "now(), now())"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "account": ids["account"],
                        "owner": ids["user"],
                        "definition": ids["definition"],
                    },
                )

            with pytest.raises(IntegrityError):
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "INSERT INTO cloud_integration_revocation_job "
                            "(id, account_id, owner_user_id, definition_id, provider_namespace, "
                            "credential_ciphertext, credential_format, status, attempt_count, "
                            "deadline_at, completed_at, created_at, updated_at) VALUES "
                            "(:id, :account, :owner, :definition, 'linear', 'must-clear', "
                            "'revocation-bundle-v1', 'succeeded', 1, now(), now(), now(), now())"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "account": ids["account"],
                            "owner": ids["user"],
                            "definition": ids["definition"],
                        },
                    )

            await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
            async with engine.begin() as conn:
                tables = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "cloud_integration_revocation_job" not in tables
                assert (
                    await conn.scalar(
                        text(
                            "SELECT auth_version FROM cloud_integration_tool_schema_cache "
                            "WHERE account_id = :account"
                        ),
                        {"account": ids["account"]},
                    )
                    == 17
                )
                assert (
                    await conn.scalar(
                        text(
                            "SELECT integration_account_auth_version "
                            "FROM cloud_integration_action_approval WHERE id = :approval"
                        ),
                        {"approval": ids["approval"]},
                    )
                    == 17
                )
                flow_columns = await conn.run_sync(
                    lambda sync_conn: {
                        column["name"]
                        for column in inspect(sync_conn).get_columns(
                            "cloud_integration_oauth_flow"
                        )
                    }
                )
                assert "revocation_endpoint" not in flow_columns

            await asyncio.to_thread(command.upgrade, config, "head")
        finally:
            await engine.dispose()
