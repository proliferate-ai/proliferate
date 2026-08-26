"""Projection proofs for additive integration lifecycle persistence fields."""

from datetime import UTC, datetime
from uuid import uuid4

from proliferate.db.models.integration_authorization import (
    CloudIntegrationAuthorizationAttempt,
    CloudIntegrationDefinitionSecurityRevision,
)
from proliferate.db.models.integrations import (
    CloudIntegrationAccount,
    CloudIntegrationOAuthClient,
    CloudIntegrationOAuthFlow,
)
from proliferate.db.store.integrations import accounts
from proliferate.db.store.integrations import authorization_attempts
from proliferate.db.store.integrations import definition_security_revisions
from proliferate.db.store.integrations import oauth_clients
from proliferate.db.store.integrations import oauth_flows


def test_account_projection_carries_split_versions_and_security_pins() -> None:
    now = datetime(2026, 8, 19, tzinfo=UTC)
    security_revision_id = uuid4()
    provider_client_id = uuid4()
    row = CloudIntegrationAccount(
        id=uuid4(),
        definition_id=uuid4(),
        owner_user_id=uuid4(),
        owner_scope="personal",
        enabled=True,
        status="ready",
        auth_kind="oauth2",
        credential_ciphertext="encrypted-account-bundle",
        credential_format="oauth-bundle-v1",
        auth_version=9,
        grant_version=4,
        credential_version=9,
        definition_security_revision_id=security_revision_id,
        provider_client_id=provider_client_id,
        credential_audience="https://resource.example",
        effective_scopes_json='["read"]',
        settings_json="{}",
        token_expires_at=now,
        last_error_code=None,
        created_at=now,
        updated_at=now,
    )

    record = accounts._record(row)

    assert record.grant_version == 4
    assert record.credential_version == 9
    assert record.definition_security_revision_id == security_revision_id
    assert record.provider_client_id == provider_client_id
    assert record.credential_audience == "https://resource.example"
    assert record.effective_scopes_json == '["read"]'
    assert record.credential_ciphertext == "encrypted-account-bundle"


def test_attempt_projection_carries_generation_pins_and_only_ciphertext() -> None:
    now = datetime(2026, 8, 19, tzinfo=UTC)
    security_revision_id = uuid4()
    provider_client_id = uuid4()
    row = CloudIntegrationAuthorizationAttempt(
        id=uuid4(),
        owner_user_id=uuid4(),
        definition_id=uuid4(),
        account_id=uuid4(),
        purpose="reauthorize",
        method="oauth2",
        generation=3,
        status="validating",
        starting_grant_version=4,
        starting_credential_version=8,
        definition_security_revision_id=security_revision_id,
        provider_client_id=provider_client_id,
        credential_audience="https://resource.example",
        settings_json='{"region":"us"}',
        requested_scopes_json='["read"]',
        effective_scopes_json='["read"]',
        staged_credential_ciphertext="encrypted-staged-bundle",
        staged_credential_format="oauth-bundle-v1",
        failure_code=None,
        expires_at=now,
        closed_at=None,
        created_at=now,
        updated_at=now,
    )

    record = authorization_attempts._record(row)

    assert record.generation == 3
    assert record.starting_grant_version == 4
    assert record.starting_credential_version == 8
    assert record.definition_security_revision_id == security_revision_id
    assert record.provider_client_id == provider_client_id
    assert record.settings_json == '{"region":"us"}'
    assert record.staged_credential_ciphertext == "encrypted-staged-bundle"


def test_revision_client_and_flow_projections_carry_lifecycle_links() -> None:
    now = datetime(2026, 8, 19, tzinfo=UTC)
    definition_id = uuid4()
    attempt_id = uuid4()
    revision_row = CloudIntegrationDefinitionSecurityRevision(
        id=uuid4(),
        definition_id=definition_id,
        revision=2,
        auth_kind="oauth2",
        oauth_client_mode="static",
        config_json='{"mcp_url":"https://resource.example"}',
        created_at=now,
    )
    client_row = CloudIntegrationOAuthClient(
        id=uuid4(),
        definition_id=definition_id,
        issuer="https://issuer.example",
        redirect_uri="https://api.example/callback",
        resource="https://resource.example",
        client_id="client-id",
        revision=2,
        lifecycle_state="retiring",
        client_secret_ciphertext="encrypted-client-secret",
        client_secret_expires_at=None,
        token_endpoint_auth_method="client_secret_post",
        registration_client_uri=None,
        registration_access_token_ciphertext=None,
        created_at=now,
        updated_at=now,
    )
    flow_row = CloudIntegrationOAuthFlow(
        id=uuid4(),
        account_id=None,
        attempt_id=attempt_id,
        owner_user_id=uuid4(),
        definition_id=definition_id,
        state_hash="state-hash",
        code_verifier_ciphertext="encrypted-verifier",
        issuer="https://issuer.example",
        resource="https://resource.example",
        client_id="client-id",
        token_endpoint="https://issuer.example/token",
        requested_scopes='["read"]',
        redirect_uri="https://api.example/callback",
        authorization_url="https://issuer.example/authorize",
        callback_surface="desktop",
        final_surface="desktop",
        return_path=None,
        status="active",
        expires_at=now,
        used_at=None,
        cancelled_at=None,
        failure_code=None,
        created_at=now,
        updated_at=now,
    )

    revision = definition_security_revisions._record(revision_row)
    client = oauth_clients._record(client_row)
    flow = oauth_flows._record(flow_row)

    assert revision.revision == 2
    assert revision.config_json == '{"mcp_url":"https://resource.example"}'
    assert client.revision == 2
    assert client.lifecycle_state == "retiring"
    assert client.client_secret_ciphertext == "encrypted-client-secret"
    assert flow.attempt_id == attempt_id
    assert flow.code_verifier_ciphertext == "encrypted-verifier"
