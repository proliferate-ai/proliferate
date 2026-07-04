"""Unit tests for org sandbox profile service layer."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.org_sandbox_profiles import service


def _make_sandbox_value(
    *,
    organization_id: UUID | None = None,
    display_name: str = "Team Default",
    status: str = "creating",
) -> CloudSandboxValue:
    now = datetime.now(tz=timezone.utc)
    return CloudSandboxValue(
        id=uuid4(),
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id or uuid4(),
        created_by_user_id=uuid4(),
        billing_subject_id=uuid4(),
        status=status,
        last_error=None,
        e2b_sandbox_id=None,
        e2b_template_ref="e2b",
        anyharness_base_url=None,
        anyharness_bearer_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        runtime_generation=0,
        display_name=display_name,
        created_at=now,
        updated_at=now,
        ready_at=None,
        last_health_at=None,
        destroyed_at=None,
    )


class FakeBillingSubject:
    def __init__(self) -> None:
        self.id = uuid4()


@pytest.mark.asyncio
async def test_create_org_sandbox_profile_calls_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    org_id = uuid4()
    user_id = uuid4()
    expected_sandbox = _make_sandbox_value(organization_id=org_id)
    billing_subject = FakeBillingSubject()

    lock_calls: list[dict] = []
    ensure_billing_calls: list[UUID] = []
    ensure_sandbox_calls: list[dict] = []

    async def mock_acquire_lock(db: object, **kwargs: object) -> None:
        lock_calls.append(dict(kwargs))

    async def mock_ensure_billing(db: object, org_id: UUID) -> FakeBillingSubject:
        ensure_billing_calls.append(org_id)
        return billing_subject

    async def mock_ensure_sandbox(db: object, **kwargs: object) -> CloudSandboxValue:
        ensure_sandbox_calls.append(dict(kwargs))
        return expected_sandbox

    from proliferate.db.store import billing_subjects as billing_mod
    from proliferate.db.store import cloud_sandboxes as sandbox_mod

    monkeypatch.setattr(sandbox_mod, "acquire_cloud_sandbox_owner_lock", mock_acquire_lock)
    monkeypatch.setattr(billing_mod, "ensure_organization_billing_subject", mock_ensure_billing)
    monkeypatch.setattr(sandbox_mod, "ensure_organization_cloud_sandbox", mock_ensure_sandbox)

    result = await service.create_org_sandbox_profile(
        cast(AsyncSession, object()),
        organization_id=org_id,
        created_by_user_id=user_id,
        display_name="My Team Sandbox",
    )

    assert result is expected_sandbox
    assert lock_calls[0]["owner_scope"] == "organization"
    assert lock_calls[0]["organization_id"] == org_id
    assert ensure_billing_calls[0] == org_id
    assert ensure_sandbox_calls[0]["organization_id"] == org_id
    assert ensure_sandbox_calls[0]["display_name"] == "My Team Sandbox"
    assert ensure_sandbox_calls[0]["billing_subject_id"] == billing_subject.id


@pytest.mark.asyncio
async def test_list_org_sandbox_profiles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    org_id = uuid4()
    sandboxes = [
        _make_sandbox_value(organization_id=org_id, display_name="Sandbox A"),
        _make_sandbox_value(organization_id=org_id, display_name="Sandbox B"),
    ]

    from proliferate.db.store import cloud_sandboxes as sandbox_mod

    async def mock_list(db: object, organization_id: UUID) -> list[CloudSandboxValue]:
        assert organization_id == org_id
        return sandboxes

    monkeypatch.setattr(sandbox_mod, "list_organization_cloud_sandboxes", mock_list)

    result = await service.list_org_sandbox_profiles(
        cast(AsyncSession, object()),
        organization_id=org_id,
    )

    assert len(result) == 2
    assert result[0].display_name == "Sandbox A"


@pytest.mark.asyncio
async def test_get_org_sandbox_profile_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    org_id = uuid4()
    sandbox_id = uuid4()

    from proliferate.db.store import cloud_sandboxes as sandbox_mod

    async def mock_load(
        db: object, organization_id: UUID, *, sandbox_id: UUID | None = None
    ) -> CloudSandboxValue | None:
        return None

    monkeypatch.setattr(sandbox_mod, "load_organization_cloud_sandbox", mock_load)

    with pytest.raises(CloudApiError) as exc_info:
        await service.get_org_sandbox_profile(
            cast(AsyncSession, object()),
            organization_id=org_id,
            sandbox_id=sandbox_id,
        )

    assert exc_info.value.code == "org_sandbox_profile_not_found"
    assert exc_info.value.status_code == 404
