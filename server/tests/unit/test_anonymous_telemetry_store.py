from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.anonymous_telemetry import AnonymousTelemetryLocalInstall
from proliferate.db.store.anonymous_telemetry import load_or_create_local_install_id


@pytest.mark.asyncio
async def test_load_or_create_local_install_id_reuses_existing_surface_id(
    db_session: AsyncSession,
) -> None:
    first = await load_or_create_local_install_id(db_session, "server")
    second = await load_or_create_local_install_id(db_session, "server")

    assert first == second

    records = (
        (
            await db_session.execute(
                select(AnonymousTelemetryLocalInstall).where(
                    AnonymousTelemetryLocalInstall.surface == "server"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(records) == 1
    assert records[0].install_uuid == first


@pytest.mark.asyncio
async def test_load_or_create_local_install_id_keeps_surface_ids_distinct(
    db_session: AsyncSession,
) -> None:
    desktop_install = await load_or_create_local_install_id(db_session, "desktop")
    server_install = await load_or_create_local_install_id(db_session, "server")

    assert desktop_install != server_install
