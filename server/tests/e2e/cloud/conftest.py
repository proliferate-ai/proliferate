from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from tests.e2e.cloud.helpers import (
    CloudE2ETestError,
    configure_cloud_settings_for_provider,
    ensure_provider_available,
    load_cloud_test_config,
)


@pytest.fixture(scope="session")
def cloud_test_config():  # type: ignore[no-untyped-def]
    return load_cloud_test_config()


@pytest.fixture
def require_live_cloud(  # type: ignore[no-untyped-def]
    cloud_test_config,
    provider_kind: str,
) -> None:
    try:
        ensure_provider_available(cloud_test_config, provider_kind)
    except CloudE2ETestError as exc:
        pytest.skip(str(exc))


@pytest_asyncio.fixture
async def cloud_client(  # type: ignore[no-untyped-def]
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
    provider_kind: str,
    cloud_test_config,
    require_live_cloud,
) -> AsyncGenerator[AsyncClient, None]:
    from proliferate.db import engine as engine_module
    from proliferate.main import create_app

    configure_cloud_settings_for_provider(monkeypatch, cloud_test_config, provider_kind)

    original_engine = engine_module.engine
    original_session_factory = engine_module.async_session_factory
    engine_module.engine = test_engine
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    app = create_app()
    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
    finally:
        engine_module.engine = original_engine
        engine_module.async_session_factory = original_session_factory
