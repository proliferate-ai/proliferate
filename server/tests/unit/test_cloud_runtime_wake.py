from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.server.cloud.runtime import wake as runtime_wake


@pytest.mark.asyncio
async def test_managed_target_wake_execution_lock_is_single_flight(
    test_engine,
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    target_id = uuid4()
    try:
        async with runtime_wake._managed_target_wake_execution_lock(target_id) as first:
            assert first is True
            async with runtime_wake._managed_target_wake_execution_lock(target_id) as second:
                assert second is False
    finally:
        engine_module.async_session_factory = original_factory
