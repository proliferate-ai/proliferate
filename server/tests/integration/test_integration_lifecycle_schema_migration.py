"""Real-Postgres proof for the additive integration lifecycle schema."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from proliferate.db.migrations import build_alembic_config
from tests.postgres import temporary_database

_REVISION = "a21c34d56e78"
_DOWN_REVISION = "e7f1a3c9d20b"


async def _insert_legacy_rows(conn) -> dict[str, uuid.UUID]:  # type: ignore[no-untyped-def]
    ids = {
        "user": uuid.uuid4(),
        "definition": uuid.uuid4(),
        "account": uuid.uuid4(),
        "client": uuid.uuid4(),
        "flow": uuid.uuid4(),
    }
    await conn.execute(
        text(
            'INSERT INTO "user" '
            "(id, email, hashed_password, is_active, is_superuser, is_verified, created_at) "
            "VALUES (:id, :email, 'x', true, false, true, now())"
        ),
        {"id": ids["user"], "email": f"lifecycle-{ids['user']}@example.com"},
    )
    await conn.execute(
        text(
            "INSERT INTO cloud_integration_definition "
            "(id, source, namespace, display_name, auth_kind, oauth_client_mode, "
            "config_json, enabled_by_default, created_at, updated_at) "
            "VALUES (:id, 'seed', 'migration-proof', 'Migration Proof', 'oauth2', "
            "'dcr', :config_json, true, now(), now())"
        ),
        {"id": ids["definition"], "config_json": '{"version":1}'},
    )
    await conn.execute(
        text(
            "INSERT INTO cloud_integration_account "
            "(id, definition_id, owner_user_id, owner_scope, enabled, status, auth_kind, "
            "credential_ciphertext, credential_format, auth_version, settings_json, "
            "created_at, updated_at) "
            "VALUES (:id, :definition_id, :owner_user_id, 'personal', true, 'ready', "
            "'oauth2', 'encrypted-account', 'oauth-bundle-v1', 7, '{}', now(), now())"
        ),
        {
            "id": ids["account"],
            "definition_id": ids["definition"],
            "owner_user_id": ids["user"],
        },
    )
    await conn.execute(
        text(
            "INSERT INTO cloud_integration_oauth_client "
            "(id, definition_id, issuer, redirect_uri, resource, client_id, "
            "client_secret_ciphertext, token_endpoint_auth_method, created_at, updated_at) "
            "VALUES (:id, :definition_id, 'https://issuer.example', "
            "'https://api.example/callback', 'https://resource.example', 'legacy-client', "
            "'encrypted-client', 'client_secret_post', now(), now())"
        ),
        {"id": ids["client"], "definition_id": ids["definition"]},
    )
    await conn.execute(
        text(
            "INSERT INTO cloud_integration_oauth_flow "
            "(id, account_id, owner_user_id, definition_id, state_hash, "
            "code_verifier_ciphertext, issuer, resource, client_id, token_endpoint, "
            "requested_scopes, redirect_uri, authorization_url, callback_surface, "
            "final_surface, status, expires_at, created_at, updated_at) "
            "VALUES (:id, :account_id, :owner_user_id, :definition_id, 'state-hash', "
            "'encrypted-verifier', 'https://issuer.example', 'https://resource.example', "
            "'legacy-client', 'https://issuer.example/token', '[\"read\"]', "
            "'https://api.example/callback', 'https://issuer.example/authorize', "
            "'desktop', 'desktop', 'active', now() + interval '10 minutes', now(), now())"
        ),
        {
            "id": ids["flow"],
            "account_id": ids["account"],
            "owner_user_id": ids["user"],
            "definition_id": ids["definition"],
        },
    )
    return ids


async def _assert_rejected(engine, statement: str, params: dict[str, object]) -> None:  # type: ignore[type-arg]
    with pytest.raises(IntegrityError):
        async with engine.begin() as conn:
            await conn.execute(text(statement), params)


async def test_lifecycle_schema_backfills_constraints_and_round_trips() -> None:
    async with temporary_database("integration_lifecycle_schema") as (_name, database_url):
        config = build_alembic_config(database_url)
        await asyncio.to_thread(command.upgrade, config, _DOWN_REVISION)
        engine = create_async_engine(database_url, echo=False)
        try:
            async with engine.begin() as conn:
                ids = await _insert_legacy_rows(conn)

            await asyncio.to_thread(command.upgrade, config, _REVISION)

            async with engine.begin() as conn:
                account = (
                    (
                        await conn.execute(
                            text(
                                "SELECT auth_version, grant_version, credential_version, "
                                "definition_security_revision_id, provider_client_id, "
                                "credential_audience FROM cloud_integration_account "
                                "WHERE id = :id"
                            ),
                            {"id": ids["account"]},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert dict(account) == {
                    "auth_version": 7,
                    "grant_version": 7,
                    "credential_version": 7,
                    "definition_security_revision_id": None,
                    "provider_client_id": None,
                    "credential_audience": None,
                }
                revision = (
                    (
                        await conn.execute(
                            text(
                                "SELECT revision, auth_kind, oauth_client_mode, config_json "
                                "FROM cloud_integration_definition_security_revision "
                                "WHERE definition_id = :definition_id"
                            ),
                            {"definition_id": ids["definition"]},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert dict(revision) == {
                    "revision": 1,
                    "auth_kind": "oauth2",
                    "oauth_client_mode": "dcr",
                    "config_json": '{"version":1}',
                }
                client = (
                    (
                        await conn.execute(
                            text(
                                "SELECT revision, lifecycle_state "
                                "FROM cloud_integration_oauth_client WHERE id = :id"
                            ),
                            {"id": ids["client"]},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert dict(client) == {"revision": 1, "lifecycle_state": "active"}
                assert (
                    await conn.scalar(
                        text("SELECT attempt_id FROM cloud_integration_oauth_flow WHERE id = :id"),
                        {"id": ids["flow"]},
                    )
                    is None
                )

                security_revision_id = await conn.scalar(
                    text(
                        "SELECT id FROM cloud_integration_definition_security_revision "
                        "WHERE definition_id = :definition_id"
                    ),
                    {"definition_id": ids["definition"]},
                )
                live_attempt_id = uuid.uuid4()
                await conn.execute(
                    text(
                        "INSERT INTO cloud_integration_authorization_attempt "
                        "(id, owner_user_id, definition_id, account_id, purpose, method, "
                        "generation, status, starting_grant_version, "
                        "starting_credential_version, definition_security_revision_id, "
                        "provider_client_id, credential_audience, requested_scopes_json, "
                        "expires_at) "
                        "VALUES (:id, :owner, :definition, :account, 'reauthorize', 'oauth2', "
                        "1, 'active', 7, 7, :security_revision, :client, "
                        "'https://resource.example', '[\"read\"]', now() + interval '10 minutes')"
                    ),
                    {
                        "id": live_attempt_id,
                        "owner": ids["user"],
                        "definition": ids["definition"],
                        "account": ids["account"],
                        "security_revision": security_revision_id,
                        "client": ids["client"],
                    },
                )

            attempt_insert = (
                "INSERT INTO cloud_integration_authorization_attempt "
                "(id, owner_user_id, definition_id, account_id, purpose, method, generation, "
                "status, starting_grant_version, starting_credential_version, "
                "definition_security_revision_id, credential_audience, "
                "staged_credential_ciphertext, staged_credential_format, closed_at, expires_at) "
                "VALUES (:id, :owner, :definition, :account, :purpose, 'oauth2', :generation, "
                ":status, :starting_grant, :starting_credential, :security_revision, "
                ":audience, :staged, :staged_format, :closed_at, "
                "now() + interval '10 minutes')"
            )
            closed_at = datetime.now(UTC)
            base = {
                "owner": ids["user"],
                "definition": ids["definition"],
                "security_revision": security_revision_id,
                "account": None,
                "purpose": "connect",
                "starting_grant": None,
                "starting_credential": None,
                "audience": "https://resource.example",
                "staged": None,
                "staged_format": None,
            }
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 1,
                    "status": "failed",
                    "closed_at": closed_at,
                },
            )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 2,
                    "status": "active",
                    "closed_at": None,
                },
            )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 2,
                    "status": "failed",
                    "staged": "encrypted-without-format",
                    "closed_at": closed_at,
                },
            )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 4,
                    "status": "failed",
                    "closed_at": None,
                },
            )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 5,
                    "status": "failed",
                    "audience": "   ",
                    "closed_at": closed_at,
                },
            )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 6,
                    "status": "failed",
                    "account": ids["account"],
                    "starting_grant": 7,
                    "starting_credential": 7,
                    "closed_at": closed_at,
                },
            )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 7,
                    "status": "failed",
                    "purpose": "reauthorize",
                    "closed_at": closed_at,
                },
            )
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "UPDATE cloud_integration_authorization_attempt "
                        "SET status = 'failed', closed_at = now() WHERE id = :id"
                    ),
                    {"id": live_attempt_id},
                )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 8,
                    "status": "active",
                    "closed_at": closed_at,
                },
            )
            await _assert_rejected(
                engine,
                attempt_insert,
                {
                    **base,
                    "id": uuid.uuid4(),
                    "generation": 3,
                    "status": "unknown",
                    "closed_at": closed_at,
                },
            )
            await _assert_rejected(
                engine,
                "INSERT INTO cloud_integration_oauth_client "
                "(id, definition_id, issuer, redirect_uri, client_id, revision, "
                "lifecycle_state, created_at, updated_at) "
                "VALUES (:id, :definition, 'https://issuer.example', "
                "'https://api.example/callback', 'new-client', 2, 'active', now(), now())",
                {"id": uuid.uuid4(), "definition": ids["definition"]},
            )
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO cloud_integration_oauth_client "
                        "(id, definition_id, issuer, redirect_uri, client_id, revision, "
                        "lifecycle_state, created_at, updated_at) "
                        "VALUES (:id, :definition, 'https://issuer.example', "
                        "'https://api.example/callback', 'retired-client', 2, 'retired', "
                        "now(), now())"
                    ),
                    {"id": uuid.uuid4(), "definition": ids["definition"]},
                )

            await asyncio.to_thread(command.downgrade, config, _DOWN_REVISION)
            async with engine.begin() as conn:
                tables = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "cloud_integration_authorization_attempt" not in tables
                assert "cloud_integration_definition_security_revision" not in tables
                account_columns = await conn.run_sync(
                    lambda sync_conn: {
                        column["name"]
                        for column in inspect(sync_conn).get_columns("cloud_integration_account")
                    }
                )
                assert {
                    "grant_version",
                    "credential_version",
                    "definition_security_revision_id",
                    "provider_client_id",
                    "credential_audience",
                    "effective_scopes_json",
                }.isdisjoint(account_columns)
                assert (
                    await conn.scalar(
                        text("SELECT auth_version FROM cloud_integration_account WHERE id = :id"),
                        {"id": ids["account"]},
                    )
                    == 7
                )
                assert (
                    await conn.scalar(
                        text(
                            "SELECT client_id FROM cloud_integration_oauth_client WHERE id = :id"
                        ),
                        {"id": ids["client"]},
                    )
                    == "legacy-client"
                )
                assert (
                    await conn.scalar(
                        text("SELECT status FROM cloud_integration_oauth_flow WHERE id = :id"),
                        {"id": ids["flow"]},
                    )
                    == "active"
                )

            await asyncio.to_thread(command.upgrade, config, "head")
        finally:
            await engine.dispose()
