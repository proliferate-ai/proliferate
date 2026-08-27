"""Integration tests for the agent gateway auth APIs (key vault, selections)."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.agent_gateway import AgentApiKey
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store, organizations as organization_store
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from tests.helpers.desktop_auth import mint_desktop_token_payload

SECRET = "sk-ant-api03-super-secret-payload-abc4"


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session
    from proliferate.server.organizations.membership_policy import place_new_identity

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Gateway Tester",
                ),
            )
            await place_new_identity(session, user)
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)
    assert user_id is not None
    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="agent-gateway",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


async def _authed_user(client: AsyncClient) -> tuple[str, dict[str, str]]:
    tokens = await _register_and_login(
        client,
        f"agent-gateway-api-{uuid.uuid4().hex[:8]}@example.com",
    )
    return tokens["user_id"], {"Authorization": f"Bearer {tokens['access_token']}"}


async def _org_enrollment_row(db_session: AsyncSession, user_id: str):
    """The authed user's DEFAULT-org enrollment row (org-only account model).

    Signup already placed the user into a default org; the resolver
    (`get_gateway_enrollment_for_user`) resolves that org unconditionally, so
    the enrollment row must live there — a row on any later-joined org would
    never govern. Falls back to creating the placement when a test user
    somehow has none.
    """
    member_id = uuid.UUID(user_id)
    default_org = await organization_store.get_default_organization_for_user(db_session, member_id)
    if default_org is not None:
        organization_id = default_org.organization.id
    else:
        organization = Organization(name=f"API Org {uuid.uuid4().hex[:6]}")
        db_session.add(organization)
        await db_session.flush()
        db_session.add(
            OrganizationMembership(
                organization_id=organization.id,
                user_id=member_id,
                role="member",
                status="active",
            )
        )
        await db_session.flush()
        organization_id = organization.id
    subject = await ensure_organization_billing_subject(db_session, organization_id)
    enrollment = await store.ensure_enrollment_row(
        db_session,
        billing_subject_id=subject.id,
        organization_id=organization_id,
        user_id=member_id,
    )
    return organization_id, enrollment


def _assert_no_secret(response: Response) -> None:
    assert SECRET not in response.text
    for key in _iter_keys(response.json()):
        for fragment in ("secret", "value", "ciphertext"):
            assert fragment not in key.lower(), f"response leaks field {key}"


def _iter_keys(value: object) -> list[str]:
    keys: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            keys.append(str(key))
            keys.extend(_iter_keys(child))
    elif isinstance(value, list):
        for child in value:
            keys.extend(_iter_keys(child))
    return keys


async def _create_key(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    title: str = "Work key",
    value: str = SECRET,
) -> dict[str, object]:
    response = await client.post(
        "/v1/cloud/agent-auth/keys",
        headers=headers,
        json={"title": title, "value": value},
    )
    assert response.status_code == 200, response.text
    _assert_no_secret(response)
    return response.json()


async def _put_selections(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    harness: str,
    surface: str,
    sources: list[dict[str, object]],
) -> Response:
    return await client.put(
        f"/v1/cloud/agent-auth/selections/{harness}",
        headers=headers,
        params={"surface": surface},
        json={"sources": sources},
    )


async def _create_provider_config(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    title: str = "Personal Bedrock",
    kind: str = "aws_bedrock",
    value: dict[str, str] | None = None,
) -> dict[str, object]:
    if value is None:
        value = (
            {"region": "us-east-1", "bearerToken": "bedrock-token-abcd"}
            if kind == "aws_bedrock"
            else {"endpoint": "https://my-res.openai.azure.com", "apiKey": "azure-key-abcd"}
        )
    response = await client.post(
        "/v1/cloud/agent-auth/keys/provider-config",
        headers=headers,
        json={"title": title, "kind": kind, "value": value},
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestAgentApiKeys:
    @pytest.mark.asyncio
    async def test_create_list_revoke_happy_path(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)

        created = await _create_key(client, headers)
        assert created["title"] == "Work key"
        assert created["redactedHint"] == "sk-...abc4"
        assert created["status"] == "active"
        assert created["kind"] == "api_key"

        listed = await client.get("/v1/cloud/agent-auth/keys", headers=headers)
        assert listed.status_code == 200
        _assert_no_secret(listed)
        keys = listed.json()
        assert [key["id"] for key in keys] == [created["id"]]

        revoked = await client.delete(
            f"/v1/cloud/agent-auth/keys/{created['id']}",
            headers=headers,
        )
        assert revoked.status_code == 200
        _assert_no_secret(revoked)
        assert revoked.json()["status"] == "revoked"

        listed_after = await client.get("/v1/cloud/agent-auth/keys", headers=headers)
        assert listed_after.json() == []

        # Ciphertext lives in the DB; the raw value never does.
        row = (
            await db_session.execute(
                select(AgentApiKey).where(AgentApiKey.id == uuid.UUID(str(created["id"])))
            )
        ).scalar_one()
        assert row.value_ciphertext != SECRET
        assert SECRET not in row.value_ciphertext

    @pytest.mark.asyncio
    async def test_create_provider_config_happy_path(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)

        response = await client.post(
            "/v1/cloud/agent-auth/keys/provider-config",
            headers=headers,
            json={
                "title": "Personal Bedrock",
                "kind": "aws_bedrock",
                "value": {"region": "us-east-1", "bearerToken": "bedrock-token-abcd"},
            },
        )
        assert response.status_code == 200, response.text
        _assert_no_secret(response)
        created = response.json()
        assert created["title"] == "Personal Bedrock"
        assert created["kind"] == "aws_bedrock"
        assert "bedrock-token-abcd" not in response.text

        listed = await client.get("/v1/cloud/agent-auth/keys", headers=headers)
        assert listed.status_code == 200
        _assert_no_secret(listed)
        keys = listed.json()
        assert [key["id"] for key in keys] == [created["id"]]
        assert keys[0]["kind"] == "aws_bedrock"

        # Ciphertext lives in the DB; the raw JSON payload never does.
        row = (
            await db_session.execute(
                select(AgentApiKey).where(AgentApiKey.id == uuid.UUID(str(created["id"])))
            )
        ).scalar_one()
        assert row.kind == "aws_bedrock"
        assert "bedrock-token-abcd" not in row.value_ciphertext

    @pytest.mark.asyncio
    async def test_create_provider_config_rejects_unsupported_kind(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)

        response = await client.post(
            "/v1/cloud/agent-auth/keys/provider-config",
            headers=headers,
            json={
                "title": "Bad kind",
                "kind": "not_a_real_kind",
                "value": {"anything": "value"},
            },
        )
        # Rejected by pydantic's Literal validation before reaching the service.
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_provider_config_rejects_empty_value(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)

        response = await client.post(
            "/v1/cloud/agent-auth/keys/provider-config",
            headers=headers,
            json={"title": "Empty", "kind": "azure_openai", "value": {}},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_provider_config_value"

    @pytest.mark.asyncio
    async def test_create_provider_config_rejects_wrong_kind_fields(
        self,
        client: AsyncClient,
    ) -> None:
        """Bedrock's field keys (region/bearerToken) submitted under the
        azure_openai kind must be rejected -- the required-field vocabulary
        is per-kind (matching D2's provider-config-fields.ts), not
        interchangeable.
        """
        _, headers = await _authed_user(client)

        response = await client.post(
            "/v1/cloud/agent-auth/keys/provider-config",
            headers=headers,
            json={
                "title": "Wrong kind fields",
                "kind": "azure_openai",
                "value": {"region": "us-east-1", "bearerToken": "bedrock-token-abcd"},
            },
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_agent_provider_config_fields"

    @pytest.mark.asyncio
    async def test_create_provider_config_rejects_arbitrary_keys(
        self,
        client: AsyncClient,
    ) -> None:
        """Unknown field keys for a kind must be rejected, not silently stored."""
        _, headers = await _authed_user(client)

        response = await client.post(
            "/v1/cloud/agent-auth/keys/provider-config",
            headers=headers,
            json={
                "title": "Arbitrary keys",
                "kind": "aws_bedrock",
                "value": {"region": "us-east-1", "somethingElse": "value"},
            },
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_agent_provider_config_fields"

    @pytest.mark.asyncio
    async def test_create_azure_provider_config_takes_endpoint_and_key_only(
        self,
        client: AsyncClient,
    ) -> None:
        """R5 (founder-ruled): the azure_openai vault entry collects endpoint +
        apiKey only. `deployment` is DROPPED — the renderer deliberately never
        translated it, so submitting it is an unknown field, not a tolerated
        legacy one."""
        _, headers = await _authed_user(client)

        ok = await client.post(
            "/v1/cloud/agent-auth/keys/provider-config",
            headers=headers,
            json={
                "title": "Personal Azure",
                "kind": "azure_openai",
                "value": {
                    "endpoint": "https://my-res.openai.azure.com",
                    "apiKey": "azure-key-abcd",
                },
            },
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["kind"] == "azure_openai"

        with_deployment = await client.post(
            "/v1/cloud/agent-auth/keys/provider-config",
            headers=headers,
            json={
                "title": "Azure with deployment",
                "kind": "azure_openai",
                "value": {
                    "endpoint": "https://my-res.openai.azure.com",
                    "deployment": "gpt-4o",
                    "apiKey": "azure-key-abcd",
                },
            },
        )
        assert with_deployment.status_code == 422
        assert with_deployment.json()["detail"]["code"] == "invalid_agent_provider_config_fields"

    @pytest.mark.asyncio
    async def test_create_rejects_empty_title_and_value(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)

        blank_title = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={"title": "   ", "value": SECRET},
        )
        assert blank_title.status_code == 400
        assert blank_title.json()["detail"]["code"] == "invalid_agent_api_key_title"

        empty_value = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={"title": "Key", "value": "   "},
        )
        assert empty_value.status_code == 400
        assert empty_value.json()["detail"]["code"] == "invalid_agent_api_key_value"

    @pytest.mark.asyncio
    async def test_create_validation_error_never_echoes_value(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)

        # `title` went schema-optional with seats v1 (the seat kind composes
        # its own), so a bare-key create without one is now the TYPED 400
        # rather than a Pydantic 422 — and its body still never echoes the
        # secret, which is what this test actually guards.
        missing_field = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={"value": SECRET},
        )
        assert missing_field.status_code == 400, missing_field.text
        assert missing_field.json()["detail"]["code"] == "invalid_agent_api_key_title"
        assert SECRET not in missing_field.text

        wrong_type = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={"title": "Key", "value": [SECRET]},
        )
        assert wrong_type.status_code == 422, wrong_type.text
        assert SECRET not in wrong_type.text

    @pytest.mark.asyncio
    async def test_revoke_foreign_key_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        _, other_headers = await _authed_user(client)
        created = await _create_key(client, owner_headers)

        response = await client.delete(
            f"/v1/cloud/agent-auth/keys/{created['id']}",
            headers=other_headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_api_key_not_found"

    @pytest.mark.asyncio
    async def test_revoke_referenced_key_is_409_with_harnesses(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert put.status_code == 200, put.text

        blocked = await client.delete(
            f"/v1/cloud/agent-auth/keys/{created['id']}",
            headers=headers,
        )
        assert blocked.status_code == 409, blocked.text
        detail = blocked.json()["detail"]
        assert detail["code"] == "agent_api_key_referenced"
        assert detail["harnesses"] == ["claude"]

        # Disabling the referencing row frees the key for revocation.
        await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": False,
                }
            ],
        )
        freed = await client.delete(
            f"/v1/cloud/agent-auth/keys/{created['id']}",
            headers=headers,
        )
        assert freed.status_code == 200, freed.text

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/v1/cloud/agent-auth/keys")
        assert response.status_code == 401


class TestAgentAuthSelections:
    @pytest.mark.asyncio
    async def test_put_list_and_full_desired_state_replace(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        put = await _put_selections(
            client,
            headers,
            harness="opencode",
            surface="local",
            sources=[
                {"sourceKind": "gateway", "enabled": True},
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "providerHint": "anthropic",
                    "enabled": True,
                },
            ],
        )
        assert put.status_code == 200, put.text
        rows = put.json()
        assert {(r["sourceKind"], r["enabled"]) for r in rows} == {
            ("gateway", True),
            ("api_key", True),
        }
        api_row = next(r for r in rows if r["sourceKind"] == "api_key")
        assert api_row["envVarName"] == "ANTHROPIC_API_KEY"
        assert api_row["providerHint"] == "anthropic"
        assert api_row["keyTitle"] == "Work key"

        listed = await client.get(
            "/v1/cloud/agent-auth/selections",
            headers=headers,
            params={"surface": "local"},
        )
        assert listed.status_code == 200
        assert len(listed.json()) == 2

        # Full desired state: dropping the api_key source deletes just its row.
        replaced = await _put_selections(
            client,
            headers,
            harness="opencode",
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert [r["sourceKind"] for r in replaced.json()] == ["gateway"]

    @pytest.mark.asyncio
    async def test_single_source_harness_rejects_two_enabled(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {"sourceKind": "gateway", "enabled": True},
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                },
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_invalid_env_var_name_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "lower_case",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_cursor_rejects_gateway_source(self, client: AsyncClient) -> None:
        # Cursor has no gateway recipe (agent-auth.md: "typed refusal, no
        # gateway route exists for cursor") — a gateway source is illegal.
        _, headers = await _authed_user(client)
        response = await _put_selections(
            client,
            headers,
            harness="cursor",
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_cursor_accepts_api_key_source(self, client: AsyncClient) -> None:
        # Cursor DOES take an api_key selection end to end (its CURSOR_API_KEY
        # slot) — only the gateway route is closed to it. The store still
        # injects the disabled gateway revision-marker row for cursor too:
        # the marker's job is keeping the scope's rendered revision
        # (max(updated_at) across all rows) monotonic, which is harness-
        # agnostic — cursor can't select the gateway source, but it still
        # needs the marker so deleting/replacing its api_key row can't move
        # the revision backwards.
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)
        response = await _put_selections(
            client,
            headers,
            harness="cursor",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "CURSOR_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 200, response.text
        rows = response.json()
        api_row = next(r for r in rows if r["sourceKind"] == "api_key")
        assert api_row["harnessKind"] == "cursor"
        assert api_row["envVarName"] == "CURSOR_API_KEY"
        assert api_row["enabled"] is True
        marker_row = next(r for r in rows if r["sourceKind"] == "gateway")
        assert marker_row["harnessKind"] == "cursor"
        assert marker_row["enabled"] is False

    @pytest.mark.asyncio
    async def test_cursor_accepts_api_key_source_on_cloud_surface(
        self, client: AsyncClient
    ) -> None:
        # Same acceptance, cloud surface — C1's headline change (cloud native
        # login) rides the same selection model regardless of surface.
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)
        response = await _put_selections(
            client,
            headers,
            harness="cursor",
            surface="cloud",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "CURSOR_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 200, response.text
        rows = response.json()
        api_row = next(r for r in rows if r["sourceKind"] == "api_key")
        assert api_row["harnessKind"] == "cursor"
        assert api_row["enabled"] is True
        marker_row = next(r for r in rows if r["sourceKind"] == "gateway")
        assert marker_row["harnessKind"] == "cursor"
        assert marker_row["enabled"] is False

    @pytest.mark.asyncio
    async def test_typed_provider_config_selection_put_succeeds(
        self,
        client: AsyncClient,
    ) -> None:
        """The typed-config write gate, open end to end (proof A5's write
        half): a declared (harness, kind) combo — claude x aws_bedrock —
        persists as an api_key row referencing the typed entry with NO
        envVarName (the typed kind carries its own env mapping)."""
        _, headers = await _authed_user(client)
        entry = await _create_provider_config(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": entry["id"],
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 200, response.text
        typed_row = next(r for r in response.json() if r["sourceKind"] == "api_key")
        assert typed_row["apiKeyId"] == entry["id"]
        assert typed_row["envVarName"] is None
        assert typed_row["keyTitle"] == "Personal Bedrock"

    @pytest.mark.asyncio
    async def test_typed_selection_with_env_var_name_is_400(
        self,
        client: AsyncClient,
    ) -> None:
        # Proof A6: a typed-entry selection naming an env var is an illegal
        # shape (the kind carries its own env mapping).
        _, headers = await _authed_user(client)
        entry = await _create_provider_config(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": entry["id"],
                    "envVarName": "AWS_REGION",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_bare_key_selection_without_env_var_name_is_400(
        self,
        client: AsyncClient,
    ) -> None:
        # Proof A6's twin: a bare-key selection must name an env var.
        _, headers = await _authed_user(client)
        created = await _create_key(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_pending_azure_claude_combo_is_refused(
        self,
        client: AsyncClient,
    ) -> None:
        """The claude x azure_openai (Foundry) cell stays CLOSED: its registry
        declaration is `pending` its Gate 4 live verification (R5/R11), so the
        registry-driven write gate refuses it even though a renderer arm
        exists. This is the pin for that exclusion."""
        _, headers = await _authed_user(client)
        entry = await _create_provider_config(
            client,
            headers,
            title="Personal Azure",
            kind="azure_openai",
        )

        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": entry["id"],
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        detail = response.json()["detail"]
        assert detail["code"] == "invalid_agent_auth_selection"
        assert "azure_openai" in detail["message"]

    @pytest.mark.asyncio
    async def test_pending_azure_codex_combo_is_refused(
        self,
        client: AsyncClient,
    ) -> None:
        # codex x azure_openai is registry-`pending` (config.toml injection
        # live-unverified) — same refusal as claude's Foundry cell.
        _, headers = await _authed_user(client)
        entry = await _create_provider_config(
            client,
            headers,
            title="Personal Azure",
            kind="azure_openai",
        )

        response = await _put_selections(
            client,
            headers,
            harness="codex",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": entry["id"],
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_undeclared_harness_typed_combo_is_refused(
        self,
        client: AsyncClient,
    ) -> None:
        # grok declares no providerConfig kinds at all — any typed reference
        # is refused by the same registry-driven gate.
        _, headers = await _authed_user(client)
        entry = await _create_provider_config(client, headers)

        response = await _put_selections(
            client,
            headers,
            harness="grok",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": entry["id"],
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_unknown_harness_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        # A gateway source for a non-gateway-capable harness is rejected by the
        # validator up front (400, not a 500 on the String(64) column).
        response = await _put_selections(
            client,
            headers,
            harness="x" * 200,
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_malformed_api_key_id_is_400(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": "not-a-uuid",
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_auth_selection"

    @pytest.mark.asyncio
    async def test_foreign_api_key_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        _, other_headers = await _authed_user(client)
        created = await _create_key(client, owner_headers)

        response = await _put_selections(
            client,
            other_headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "ANTHROPIC_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_api_key_not_found"


class TestAgentGatewayCapabilities:
    @pytest.mark.asyncio
    async def test_capabilities_gateway_off(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_enabled", False)
        monkeypatch.setattr(settings, "agent_gateway_litellm_public_base_url", "")
        _, headers = await _authed_user(client)

        response = await client.get("/v1/cloud/agent-gateway/capabilities", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["gatewayEnabled"] is False
        assert payload["publicBaseUrl"] is None
        assert payload["enrollmentStatus"] == "none"
        # The provider registry is UI-only now (contract §6): never on the wire.
        assert "providers" not in payload

    @pytest.mark.asyncio
    async def test_capabilities_gateway_on_with_enrollment(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_enabled", True)
        monkeypatch.setattr(
            settings,
            "agent_gateway_litellm_public_base_url",
            "https://llm.proliferate.ai",
        )
        user_id, headers = await _authed_user(client)

        await _org_enrollment_row(db_session, user_id)
        await db_session.commit()

        response = await client.get("/v1/cloud/agent-gateway/capabilities", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["gatewayEnabled"] is True
        assert payload["publicBaseUrl"] == "https://llm.proliferate.ai"
        assert payload["enrollmentStatus"] == "pending"


class TestAgentGatewayEnrollment:
    @pytest.mark.asyncio
    async def test_enrollment_summary_never_leaks_virtual_key(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        org_id, enrollment = await _org_enrollment_row(db_session, user_id)
        await store.mark_enrollment_synced(
            db_session,
            enrollment_id=enrollment.id,
            litellm_team_id="team-1",
            litellm_user_id=f"org-{org_id}-user-{user_id}",
            virtual_key_id="token-1",
            virtual_key="sk-litellm-virtual-key-plaintext",
            sync_fingerprint="fp",
        )
        await db_session.commit()

        response = await client.get("/v1/cloud/agent-gateway/enrollment", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["subjectKind"] == "organization"
        assert payload["litellmTeamId"] == "team-1"
        assert payload["syncStatus"] == "synced"
        assert "sk-litellm-virtual-key-plaintext" not in response.text
        for key in _iter_keys(payload):
            assert "key" not in key.lower(), f"enrollment response exposes field {key}"

    @pytest.mark.asyncio
    async def test_enrollment_missing_is_404(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.get("/v1/cloud/agent-gateway/enrollment", headers=headers)
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "agent_gateway_enrollment_not_found"


async def _get_state(client: AsyncClient, headers: dict[str, str], surface: str) -> Response:
    return await client.get(
        "/v1/cloud/agent-auth/state",
        headers=headers,
        params={"surface": surface},
    )


class TestAgentAuthState:
    @pytest.mark.asyncio
    async def test_empty_state_is_v2_no_harnesses(self, client: AsyncClient) -> None:
        user_id, headers = await _authed_user(client)
        empty = await _get_state(client, headers, "local")
        assert empty.status_code == 200, empty.text
        payload = empty.json()
        # `fingerprint` is a response-only delivery-ack rider, never part of
        # the state.json wire contract the desktop pushes to the runtime.
        fingerprint = payload.pop("fingerprint")
        assert isinstance(fingerprint, str) and len(fingerprint) == 64
        assert payload == {
            "version": 2,
            "revision": 0,
            "user_id": user_id,
            "harnesses": [],
            "harness_settings": {},
        }

    @pytest.mark.asyncio
    async def test_seeded_gateway_and_api_key_render_valid_v2(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Contract §8 e2e: a user with one gateway selection + one api_key
        # selection yields a valid v2 document carrying the caller's own keys.
        monkeypatch.setattr(
            settings,
            "agent_gateway_litellm_public_base_url",
            "https://llm.proliferate.ai",
        )
        user_id, headers = await _authed_user(client)

        org_id, enrollment = await _org_enrollment_row(db_session, user_id)
        await store.mark_enrollment_synced(
            db_session,
            enrollment_id=enrollment.id,
            litellm_team_id="team-1",
            litellm_user_id=f"org-{org_id}-user-{user_id}",
            virtual_key_id=None,
            virtual_key=None,
            sync_fingerprint="fp",
        )
        # Post-B2/B3: the renderer resolves the harness's own per-harness
        # child key (model-gateway.md §Account model), not a key on the
        # parent enrollment row.
        await store.upsert_enrollment_key(
            db_session,
            enrollment_id=enrollment.id,
            harness_kind="claude",
            virtual_key_id="token-1",
            virtual_key="sk-litellm-vk",
            sync_fingerprint="fp",
        )
        await db_session.commit()

        created = await _create_key(client, headers)

        gateway = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[{"sourceKind": "gateway", "enabled": True}],
        )
        assert gateway.status_code == 200, gateway.text
        keyed = await _put_selections(
            client,
            headers,
            harness="codex",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": created["id"],
                    "envVarName": "OPENAI_API_KEY",
                    "enabled": True,
                }
            ],
        )
        assert keyed.status_code == 200, keyed.text

        response = await _get_state(client, headers, "local")
        assert response.status_code == 200, response.text
        doc = response.json()
        assert doc["version"] == 2
        assert doc["user_id"] == user_id
        assert isinstance(doc["revision"], int) and doc["revision"] > 0
        assert doc["harnesses"] == [
            {
                "harness_kind": "claude",
                "sources": [
                    {
                        "kind": "gateway",
                        "base_url": "https://llm.proliferate.ai",
                        "key": "sk-litellm-vk",
                    }
                ],
            },
            {
                "harness_kind": "codex",
                "sources": [
                    {
                        "kind": "api_key",
                        "env_var_name": "OPENAI_API_KEY",
                        "value": SECRET,
                    }
                ],
            },
        ]

        # A different surface with no selections is still a valid empty v2 doc.
        cloud = await _get_state(client, headers, "cloud")
        assert cloud.status_code == 200
        assert cloud.json()["harnesses"] == []

    @pytest.mark.asyncio
    async def test_typed_selection_renders_provider_config_source_end_to_end(
        self,
        client: AsyncClient,
    ) -> None:
        """Proof A5's write→render corridor through the REAL write path: a
        typed vault entry + a selection with no env var, written through PUT
        /selections (the now-open gate), renders on GET /state as the
        `provider_config` wire source carrying the harness's own env set."""
        _, headers = await _authed_user(client)
        entry = await _create_provider_config(client, headers)

        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[
                {
                    "sourceKind": "api_key",
                    "apiKeyId": entry["id"],
                    "enabled": True,
                }
            ],
        )
        assert put.status_code == 200, put.text

        response = await _get_state(client, headers, "local")
        assert response.status_code == 200, response.text
        doc = response.json()
        assert doc["harnesses"] == [
            {
                "harness_kind": "claude",
                "sources": [
                    {
                        "kind": "provider_config",
                        "config_kind": "aws_bedrock",
                        "env": {
                            "CLAUDE_CODE_USE_BEDROCK": "1",
                            "AWS_BEARER_TOKEN_BEDROCK": "bedrock-token-abcd",
                            "AWS_REGION": "us-east-1",
                        },
                    }
                ],
            }
        ]

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get(
            "/v1/cloud/agent-auth/state",
            params={"surface": "local"},
        )
        assert response.status_code == 401


class TestOldAgentGatewayRoutesAreGone:
    @pytest.mark.asyncio
    async def test_the_old_agent_gateway_routes_are_gone(self, client: AsyncClient) -> None:
        """S1 moved the vault/selections/state/org-policy routes off
        ``/agent-gateway`` onto ``/agent-auth`` (enrollment + capabilities
        stayed put, model-gateway.md's gateway-account concerns). Any request
        that still lands on the old prefix must 404, not silently resolve to
        something else -- a shadowed route here would mean the old client
        SDKs land on an endpoint with different auth/behavior instead of a
        clean, loud failure.
        """
        _, headers = await _authed_user(client)
        org = uuid.uuid4()
        for path, method in (
            ("/v1/cloud/agent-gateway/keys", "get"),
            ("/v1/cloud/agent-gateway/keys", "post"),
            ("/v1/cloud/agent-gateway/keys/provider-config", "post"),
            (f"/v1/cloud/agent-gateway/keys/{uuid.uuid4()}", "delete"),
            ("/v1/cloud/agent-gateway/selections", "get"),
            ("/v1/cloud/agent-gateway/selections/claude", "put"),
            ("/v1/cloud/agent-gateway/state", "get"),
            (f"/v1/cloud/organizations/{org}/agent-gateway/policy", "get"),
            (f"/v1/cloud/organizations/{org}/agent-gateway/policy", "put"),
            (f"/v1/cloud/organizations/{org}/agent-gateway/policy/violations", "get"),
        ):
            response = await getattr(client, method)(path, headers=headers)
            assert response.status_code == 404, f"{method} {path}"

    def test_agent_auth_and_agent_gateway_prefixes_carry_the_right_routes(self) -> None:
        """Pin the S1 split by structure, not by probing random 404s.

        The org-policy 404s above only prove the org guard rejects a random
        org id -- they'd pass even if S1 never moved a route. This asserts the
        actual shape: every vault/selections/state/org-policy route now lives
        under ``/agent-auth``, and only enrollment + capabilities (the
        gateway-account concerns model-gateway.md scopes to that prefix)
        remain under ``/agent-gateway``.
        """
        from proliferate.main import app

        spec = app.openapi()
        registered = [
            (method.upper(), path)
            for path, operations in spec["paths"].items()
            for method in operations
        ]

        agent_auth = sorted(pair for pair in registered if "/agent-auth" in pair[1])
        assert agent_auth == [
            ("DELETE", "/v1/cloud/agent-auth/keys/{key_id}"),
            ("GET", "/v1/cloud/agent-auth/keys"),
            ("GET", "/v1/cloud/agent-auth/selections"),
            ("GET", "/v1/cloud/agent-auth/state"),
            ("GET", "/v1/cloud/organizations/{organization_id}/agent-auth/policy"),
            (
                "GET",
                "/v1/cloud/organizations/{organization_id}/agent-auth/policy/violations",
            ),
            ("POST", "/v1/cloud/agent-auth/keys"),
            ("POST", "/v1/cloud/agent-auth/keys/provider-config"),
            ("POST", "/v1/cloud/agent-auth/seats/{key_id}/limit-hit"),
            ("POST", "/v1/cloud/agent-auth/state/ack"),
            ("PUT", "/v1/cloud/agent-auth/selections/{harness_kind}"),
            ("PUT", "/v1/cloud/organizations/{organization_id}/agent-auth/policy"),
        ]

        agent_gateway = sorted(pair for pair in registered if "/agent-gateway" in pair[1])
        assert agent_gateway == [
            ("GET", "/v1/cloud/agent-gateway/capabilities"),
            ("GET", "/v1/cloud/agent-gateway/enrollment"),
        ]


SEAT_TOKEN = "sk-ant-oat01-MintedSeatTokenMintedSeatTokenMintedSeatAA"


class TestSeatMintIntakeAndRender:
    """Seats v1 (slice 1): the server half of mint → store → render.

    The runtime half (capture → apply → launch env) is proven in
    anyharness-lib's `seat_mint_store_render_launch_roundtrip`; the contract
    fixture pins the wire shape both halves meet on.
    """

    @pytest.mark.asyncio
    async def test_seat_mint_store_render_roundtrip(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)

        # Mint intake: the courier's one POST of the captured token.
        minted = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={
                "value": SEAT_TOKEN,
                "kind": "anthropic_subscription",
                "email": "ops@acme.com",
                "planTier": "Max 20x",
            },
        )
        assert minted.status_code == 200, minted.text
        seat = minted.json()
        assert seat["kind"] == "anthropic_subscription"
        assert seat["title"] == "Max seat · ops@acme.com · Max 20x"
        assert SEAT_TOKEN not in minted.text

        # The token never lands in the DB in the clear.
        row = (
            await db_session.execute(
                select(AgentApiKey).where(AgentApiKey.id == uuid.UUID(str(seat["id"])))
            )
        ).scalar_one()
        assert SEAT_TOKEN not in row.value_ciphertext

        # Wire the pool seat selection and render the surface.
        put = await _put_selections(
            client,
            headers,
            harness="claude",
            surface="local",
            sources=[{"sourceKind": "seat"}],
        )
        assert put.status_code == 200, put.text
        state = await _get_state(client, headers, "local")
        assert state.status_code == 200
        claude = next(
            entry for entry in state.json()["harnesses"] if entry["harness_kind"] == "claude"
        )
        assert claude["sources"] == [
            {
                "kind": "seat",
                "env": {"CLAUDE_CODE_OAUTH_TOKEN": SEAT_TOKEN},
                "seat_id": seat["id"],
            }
        ]

        # Revoking the seat removes it from the next render; the entry stays
        # present-but-empty so the harness refuses at launch (the acceptance
        # gate's secondary check).
        revoked = await client.delete(
            f"/v1/cloud/agent-auth/keys/{seat['id']}",
            headers=headers,
        )
        assert revoked.status_code == 200, revoked.text
        state_after = await _get_state(client, headers, "local")
        claude_after = next(
            entry for entry in state_after.json()["harnesses"] if entry["harness_kind"] == "claude"
        )
        assert claude_after["sources"] == []

    @pytest.mark.asyncio
    async def test_seat_mint_defaults_title_to_max_seat_n(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        first = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={"value": SEAT_TOKEN, "kind": "anthropic_subscription"},
        )
        assert first.status_code == 200, first.text
        assert first.json()["title"] == "Max seat 1"
        second = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={"value": SEAT_TOKEN + "B", "kind": "anthropic_subscription"},
        )
        assert second.json()["title"] == "Max seat 2"

    @pytest.mark.asyncio
    async def test_bare_key_create_still_requires_a_title(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.post(
            "/v1/cloud/agent-auth/keys",
            headers=headers,
            json={"value": "sk-ant-plain-key-abcd"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_agent_api_key_title"

    @pytest.mark.asyncio
    async def test_seat_selection_rejected_for_seatless_harness(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await _put_selections(
            client,
            headers,
            harness="codex",
            surface="local",
            sources=[{"sourceKind": "seat"}],
        )
        assert response.status_code == 400
        assert "no seat recipe" in response.json()["detail"]["message"]
