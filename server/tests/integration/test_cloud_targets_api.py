"""Integration tests: minimal cloud-targets slice with per-target bearer.

Covers the ssh/personal-target design §3.3: the per-runtime AnyHarness
bearer is minted at enrollment and stored as recoverable ciphertext, a
re-enrollment rotates it, the install command carries it, the owner-gated
runtime-access endpoint returns it (404 for foreign callers and unminted
rows), and list/detail payloads never leak it.
"""

from __future__ import annotations

import shlex
import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.utils.crypto import decrypt_text
from tests.integration.test_agent_gateway_api import _authed_user

_TARGETS = "/v1/cloud/targets"


async def _enroll(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    display_name: str = "ssh-box",
    kind: str = "ssh",
) -> Response:
    return await client.post(
        _TARGETS,
        headers=headers,
        json={"displayName": display_name, "kind": kind},
    )


async def _stored_ciphertext(db_session: AsyncSession, target_id: str) -> str | None:
    row = (
        await db_session.execute(select(CloudTarget).where(CloudTarget.id == uuid.UUID(target_id)))
    ).scalar_one()
    return row.anyharness_bearer_token_ciphertext


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


class TestEnrollmentBearer:
    @pytest.mark.asyncio
    async def test_enroll_mints_encrypted_bearer(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)
        response = await _enroll(client, headers)
        assert response.status_code == 200, response.text
        body = response.json()
        bearer = body["anyharnessBearerToken"]
        assert bearer
        assert body["enrollmentToken"]
        assert body["target"]["kind"] == "ssh"
        assert body["target"]["status"] == "enrolling"

        ciphertext = await _stored_ciphertext(db_session, body["target"]["id"])
        assert ciphertext is not None
        # Recoverable ciphertext, never the plaintext at rest.
        assert bearer not in ciphertext
        assert decrypt_text(ciphertext) == bearer

    @pytest.mark.asyncio
    async def test_install_command_carries_bearer_env(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        response = await _enroll(client, headers)
        assert response.status_code == 200, response.text
        body = response.json()
        install_command = body["installCommand"]
        quoted_bearer = shlex.quote(body["anyharnessBearerToken"])
        bearer_env = f"PROLIFERATE_ANYHARNESS_BEARER_TOKEN={quoted_bearer}"
        token_env = f"PROLIFERATE_ENROLLMENT_TOKEN={shlex.quote(body['enrollmentToken'])}"
        assert bearer_env in install_command
        assert token_env in install_command
        assert "PROLIFERATE_CLOUD_URL=" in install_command

    @pytest.mark.asyncio
    async def test_reenroll_rotates_bearer(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        _, headers = await _authed_user(client)
        first = await _enroll(client, headers)
        assert first.status_code == 200, first.text
        target_id = first.json()["target"]["id"]
        first_bearer = first.json()["anyharnessBearerToken"]

        second = await client.post(f"{_TARGETS}/{target_id}/enrollments", headers=headers)
        assert second.status_code == 200, second.text
        body = second.json()
        second_bearer = body["anyharnessBearerToken"]
        assert second_bearer
        assert second_bearer != first_bearer
        assert (
            f"PROLIFERATE_ANYHARNESS_BEARER_TOKEN={shlex.quote(second_bearer)}"
            in body["installCommand"]
        )
        assert body["target"]["status"] == "enrolling"

        ciphertext = await _stored_ciphertext(db_session, target_id)
        assert ciphertext is not None
        assert decrypt_text(ciphertext) == second_bearer

    @pytest.mark.asyncio
    async def test_reenroll_foreign_target_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        enrolled = await _enroll(client, owner_headers)
        target_id = enrolled.json()["target"]["id"]

        _, other_headers = await _authed_user(client)
        response = await client.post(
            f"{_TARGETS}/{target_id}/enrollments",
            headers=other_headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "cloud_target_not_found"


class TestRuntimeAccess:
    @pytest.mark.asyncio
    async def test_owner_reads_bearer(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        enrolled = await _enroll(client, headers)
        assert enrolled.status_code == 200, enrolled.text
        target_id = enrolled.json()["target"]["id"]
        bearer = enrolled.json()["anyharnessBearerToken"]

        response = await client.get(f"{_TARGETS}/{target_id}/runtime-access", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json() == {"anyharnessBearerToken": bearer}

    @pytest.mark.asyncio
    async def test_non_owner_is_404(self, client: AsyncClient) -> None:
        _, owner_headers = await _authed_user(client)
        enrolled = await _enroll(client, owner_headers)
        target_id = enrolled.json()["target"]["id"]

        _, other_headers = await _authed_user(client)
        response = await client.get(
            f"{_TARGETS}/{target_id}/runtime-access",
            headers=other_headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "cloud_target_not_found"

    @pytest.mark.asyncio
    async def test_unknown_target_is_404(self, client: AsyncClient) -> None:
        _, headers = await _authed_user(client)
        response = await client.get(
            f"{_TARGETS}/{uuid.uuid4()}/runtime-access",
            headers=headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "cloud_target_not_found"

    @pytest.mark.asyncio
    async def test_unminted_bearer_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, headers = await _authed_user(client)
        target = CloudTarget(
            display_name="pre-bearer-box",
            kind="ssh",
            status="online",
            owner_scope="personal",
            owner_user_id=uuid.UUID(user_id),
            created_by_user_id=uuid.UUID(user_id),
        )
        db_session.add(target)
        await db_session.commit()

        response = await client.get(f"{_TARGETS}/{target.id}/runtime-access", headers=headers)
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "cloud_target_runtime_access_unavailable"


class TestNoBearerLeakage:
    @pytest.mark.asyncio
    async def test_list_and_detail_never_carry_the_bearer(
        self,
        client: AsyncClient,
    ) -> None:
        _, headers = await _authed_user(client)
        enrolled = await _enroll(client, headers)
        assert enrolled.status_code == 200, enrolled.text
        target_id = enrolled.json()["target"]["id"]
        bearer = enrolled.json()["anyharnessBearerToken"]

        listed = await client.get(_TARGETS, headers=headers)
        assert listed.status_code == 200
        detail = await client.get(f"{_TARGETS}/{target_id}", headers=headers)
        assert detail.status_code == 200
        assert [entry["id"] for entry in listed.json()] == [target_id]

        for response in (listed, detail):
            assert bearer not in response.text
            for key in _iter_keys(response.json()):
                for fragment in ("token", "bearer", "ciphertext"):
                    assert fragment not in key.lower(), f"response leaks field {key}"
