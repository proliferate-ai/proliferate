"""Track 1b Phase 3 — function-invocation CRUD + org default-chat-scope surface.

Tier-1 coverage for the new settings-page service layer (Part II mental-model
§1/§2). Complements ``test_function_invocations.py`` (the phase-2 gateway
deny-path floor) with the create/edit/rotate/toggle round-trip these endpoints
add, plus the org-admin default-access toggle from phase 1.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.function_invocations import service

pytestmark = pytest.mark.asyncio


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"fn-settings-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def test_create_round_trip_never_returns_headers(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    created = await service.create_function_invocation(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        name="my_fn",
        endpoint_url="https://example.com/hook",
        method="POST",
        args_schema={"type": "object", "properties": {"x": {"type": "string"}}},
        headers={"Authorization": "Bearer secret"},
        display_name="My Fn",
        description="does a thing",
    )
    assert created.name == "my_fn"
    assert created.method == "post"
    assert created.has_headers is True
    assert created.chat_scope_enabled is False  # workflow-only by default (§2)
    assert not hasattr(created, "headers")
    assert "headers" not in created.model_dump()

    listed = await service.list_function_invocations(db_session, owner_user_id=user.id)
    assert [item.name for item in listed] == ["my_fn"]


async def test_create_duplicate_name_conflicts(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await service.create_function_invocation(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        name="dup_fn",
        endpoint_url="https://example.com/a",
        method="get",
        args_schema={},
        headers=None,
        display_name=None,
        description=None,
    )
    with pytest.raises(CloudApiError) as exc_info:
        await service.create_function_invocation(
            db_session,
            owner_user_id=user.id,
            organization_id=None,
            name="dup_fn",
            endpoint_url="https://example.com/b",
            method="get",
            args_schema={},
            headers=None,
            display_name=None,
            description=None,
        )
    assert exc_info.value.status_code == 409


@pytest.mark.parametrize(
    "name",
    ["Bad-Name", "1starts_with_digit", "" , "has space", "way-too-long-" * 10],
)
async def test_create_rejects_invalid_name(db_session: AsyncSession, name: str) -> None:
    user = await _make_user(db_session)
    with pytest.raises(CloudApiError) as exc_info:
        await service.create_function_invocation(
            db_session,
            owner_user_id=user.id,
            organization_id=None,
            name=name,
            endpoint_url="https://example.com/hook",
            method="post",
            args_schema={},
            headers=None,
            display_name=None,
            description=None,
        )
    assert exc_info.value.status_code == 400


async def test_create_rejects_unsupported_method(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    with pytest.raises(CloudApiError) as exc_info:
        await service.create_function_invocation(
            db_session,
            owner_user_id=user.id,
            organization_id=None,
            name="my_fn",
            endpoint_url="https://example.com/hook",
            method="head",
            args_schema={},
            headers=None,
            display_name=None,
            description=None,
        )
    assert exc_info.value.status_code == 400


async def test_create_rejects_malformed_endpoint_url(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    with pytest.raises(CloudApiError) as exc_info:
        await service.create_function_invocation(
            db_session,
            owner_user_id=user.id,
            organization_id=None,
            name="my_fn",
            endpoint_url="not-a-url",
            method="post",
            args_schema={},
            headers=None,
            display_name=None,
            description=None,
        )
    assert exc_info.value.status_code == 400


async def test_create_rejects_invalid_args_schema(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    with pytest.raises(CloudApiError) as exc_info:
        await service.create_function_invocation(
            db_session,
            owner_user_id=user.id,
            organization_id=None,
            name="my_fn",
            endpoint_url="https://example.com/hook",
            method="post",
            args_schema={"type": 12345},  # not a valid JSON-Schema type
            headers=None,
            display_name=None,
            description=None,
        )
    assert exc_info.value.status_code == 400


async def test_update_edits_only_supplied_fields(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await service.create_function_invocation(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        name="my_fn",
        endpoint_url="https://example.com/hook",
        method="post",
        args_schema={},
        headers=None,
        display_name="Original",
        description="original description",
    )
    updated = await service.update_function_invocation(
        db_session, owner_user_id=user.id, name="my_fn", endpoint_url="https://example.com/v2"
    )
    assert updated.endpoint_url == "https://example.com/v2"
    assert updated.display_name == "Original"  # untouched
    assert updated.description == "original description"  # untouched

    cleared = await service.update_function_invocation(
        db_session, owner_user_id=user.id, name="my_fn", description=None
    )
    assert cleared.description is None
    assert cleared.display_name == "Original"


async def test_rotate_headers_never_read_back(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await service.create_function_invocation(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        name="my_fn",
        endpoint_url="https://example.com/hook",
        method="post",
        args_schema={},
        headers=None,
        display_name=None,
        description=None,
    )
    rotated = await service.rotate_function_invocation_headers(
        db_session, owner_user_id=user.id, name="my_fn", headers={"X-Api-Key": "abc"}
    )
    assert rotated.has_headers is True
    assert "headers" not in rotated.model_dump()

    cleared = await service.rotate_function_invocation_headers(
        db_session, owner_user_id=user.id, name="my_fn", headers=None
    )
    assert cleared.has_headers is False


async def test_set_chat_scope_enabled_toggle_round_trips(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await service.create_function_invocation(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        name="my_fn",
        endpoint_url="https://example.com/hook",
        method="post",
        args_schema={},
        headers=None,
        display_name=None,
        description=None,
    )
    enabled = await service.set_function_invocation_chat_scope_enabled(
        db_session, owner_user_id=user.id, name="my_fn", enabled=True
    )
    assert enabled.chat_scope_enabled is True
    disabled = await service.set_function_invocation_chat_scope_enabled(
        db_session, owner_user_id=user.id, name="my_fn", enabled=False
    )
    assert disabled.chat_scope_enabled is False


async def test_archive_then_operations_404(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    await service.create_function_invocation(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        name="my_fn",
        endpoint_url="https://example.com/hook",
        method="post",
        args_schema={},
        headers=None,
        display_name=None,
        description=None,
    )
    await service.archive_function_invocation(db_session, owner_user_id=user.id, name="my_fn")
    listed = await service.list_function_invocations(db_session, owner_user_id=user.id)
    assert listed == []
    with pytest.raises(CloudApiError) as exc_info:
        await service.set_function_invocation_chat_scope_enabled(
            db_session, owner_user_id=user.id, name="my_fn", enabled=True
        )
    assert exc_info.value.status_code == 404


async def test_cross_user_isolation(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    other = await _make_user(db_session)
    await service.create_function_invocation(
        db_session,
        owner_user_id=owner.id,
        organization_id=None,
        name="my_fn",
        endpoint_url="https://example.com/hook",
        method="post",
        args_schema={},
        headers=None,
        display_name=None,
        description=None,
    )
    assert await service.list_function_invocations(db_session, owner_user_id=other.id) == []
    with pytest.raises(CloudApiError) as exc_info:
        await service.update_function_invocation(
            db_session, owner_user_id=other.id, name="my_fn", endpoint_url="https://evil.example"
        )
    assert exc_info.value.status_code == 404
