from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncConnection


async def assert_sso_schema(conn: AsyncConnection) -> None:
    sso_connection_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("sso_connection")
        }
    )
    assert {
        "id",
        "scope",
        "organization_id",
        "protocol",
        "status",
        "display_name",
        "login_policy",
        "jit_policy",
        "default_role",
        "allowed_domains_json",
        "oidc_issuer_url",
        "oidc_client_id",
        "oidc_client_secret_ciphertext",
        "oidc_token_endpoint_auth_method",
        "saml_idp_metadata_url",
        "saml_x509_cert_ciphertext",
    } <= sso_connection_columns
    sso_connection_checks = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_check_constraints("sso_connection")
        }
    )
    assert {
        "ck_sso_connection_scope",
        "ck_sso_connection_protocol",
        "ck_sso_connection_status",
        "ck_sso_connection_scope_organization",
    } <= sso_connection_checks
    sso_connection_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("sso_connection")
        }
    )
    assert {
        "ix_sso_connection_organization_status",
        "ix_sso_connection_scope_status",
    } <= sso_connection_indexes

    sso_challenge_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("sso_challenge")
        }
    )
    assert {
        "id",
        "scope",
        "connection_id",
        "connection_key",
        "organization_id",
        "protocol",
        "surface",
        "purpose",
        "state_hash",
        "nonce_hash",
        "client_state",
        "code_challenge",
        "redirect_uri",
        "login_hint",
        "expires_at",
        "consumed_at",
    } <= sso_challenge_columns
    sso_challenge_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints("sso_challenge")
        }
    )
    assert "uq_sso_challenge_state_hash" in sso_challenge_uniques
    sso_challenge_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("sso_challenge")
        }
    )
    assert {
        "ix_sso_challenge_state_hash",
        "ix_sso_challenge_connection_key",
        "ix_sso_challenge_organization_id",
    } <= sso_challenge_indexes

    sso_identity_columns = await conn.run_sync(
        lambda sync_conn: {
            column["name"] for column in inspect(sync_conn).get_columns("sso_identity")
        }
    )
    assert {
        "id",
        "user_id",
        "organization_id",
        "connection_id",
        "connection_key",
        "protocol",
        "provider_subject",
        "email",
        "email_verified",
        "last_login_at",
    } <= sso_identity_columns
    sso_identity_uniques = await conn.run_sync(
        lambda sync_conn: {
            constraint["name"]
            for constraint in inspect(sync_conn).get_unique_constraints("sso_identity")
        }
    )
    assert "uq_sso_identity_connection_subject" in sso_identity_uniques
    sso_identity_indexes = await conn.run_sync(
        lambda sync_conn: {
            index["name"] for index in inspect(sync_conn).get_indexes("sso_identity")
        }
    )
    assert {
        "ix_sso_identity_user_id",
        "ix_sso_identity_organization_id",
        "ix_sso_identity_connection_id",
    } <= sso_identity_indexes
