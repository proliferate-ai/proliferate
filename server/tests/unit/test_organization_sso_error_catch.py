from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.auth.sso.types import SsoConnectionSnapshot
from proliferate.db.store.auth_sso_records import SsoConnectionRecord
from proliferate.server.organizations.sso import service


@pytest.mark.asyncio
async def test_connection_test_records_and_reraises_auth_flow_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = cast(AsyncSession, object())
    connection_id = uuid4()
    organization_id = uuid4()
    actor_user_id = uuid4()
    record = cast(SsoConnectionRecord, object())
    snapshot = cast(SsoConnectionSnapshot, object())
    source_error = AuthFlowError(
        "sso_integration_failure",
        "OIDC discovery metadata could not be loaded.",
        status_code=400,
    )
    get_connection = AsyncMock(return_value=record)
    test_connection = AsyncMock(side_effect=source_error)
    mark_result = AsyncMock(return_value=record)
    monkeypatch.setattr(service.sso_store, "get_sso_connection", get_connection)
    monkeypatch.setattr(service, "snapshot_from_sso_connection_record", lambda value: snapshot)
    monkeypatch.setattr(service, "test_oidc_connection", test_connection)
    monkeypatch.setattr(service.sso_store, "mark_sso_connection_test_result", mark_result)

    with pytest.raises(AuthFlowError) as exc_info:
        await service.test_organization_sso_connection(
            db,
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            connection_id=connection_id,
        )

    assert exc_info.value is source_error
    get_connection.assert_awaited_once_with(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
    )
    test_connection.assert_awaited_once_with(db, connection=snapshot)
    mark_result.assert_awaited_once_with(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
        success=False,
        error="OIDC discovery metadata could not be loaded.",
        discovered=None,
        actor_user_id=actor_user_id,
    )
