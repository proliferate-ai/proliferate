from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.anonymous_telemetry import AnonymousTelemetryLocalInstall
from proliferate.db.store.anonymous_telemetry import load_or_create_local_install_id


@pytest.mark.asyncio
async def test_load_or_create_local_install_id_reuses_existing_surface_id(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    try:
        first = await load_or_create_local_install_id("server")
        second = await load_or_create_local_install_id("server")

        assert first == second

        async with engine_module.async_session_factory() as session:
            records = (
                await session.execute(
                    select(AnonymousTelemetryLocalInstall).where(
                        AnonymousTelemetryLocalInstall.surface == "server"
                    )
                )
            ).scalars().all()
        assert len(records) == 1
        assert records[0].install_uuid == first
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_load_or_create_local_install_id_keeps_surface_ids_distinct(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    try:
        desktop_install = await load_or_create_local_install_id("desktop")
        server_install = await load_or_create_local_install_id("server")

        assert desktop_install != server_install
    finally:
        engine_module.async_session_factory = original_factory
