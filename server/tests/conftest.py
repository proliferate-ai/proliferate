"""Shared test fixtures."""

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from proliferate.config import settings
from tests.postgres import (
    TEST_DATABASE_NAME,
    TEST_DATABASE_URL,
    drop_database,
    ensure_database_exists,
    run_migrations,
    truncate_all_tables,
)


async def _cancel_test_background_tasks() -> None:
    return None


@pytest.fixture(autouse=True)
def _hosted_membership_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the membership policy to hosted (personal org per user) by default.

    The suite predates single-org mode and asserts hosted behavior. The default
    single-org expression (`telemetry_mode != "hosted_product"`) would otherwise
    flip local/test deployments into single-org mode. Tests that exercise
    single-org mode override this within the test body.
    """
    monkeypatch.setattr(settings, "single_org_mode_override", False)


@pytest.fixture(scope="session")
def event_loop():  # type: ignore[no-untyped-def]
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def migrated_test_database():  # type: ignore[no-untyped-def]
    asyncio.run(ensure_database_exists(TEST_DATABASE_NAME))
    run_migrations(TEST_DATABASE_URL)
    yield
    asyncio.run(drop_database(TEST_DATABASE_NAME))


@pytest_asyncio.fixture
async def test_engine(migrated_test_database):  # type: ignore[no-untyped-def]
    """The migrated test database, truncated clean before and after the test.

    Every route a test has into Postgres runs through this fixture: `db_session`
    and `client` here, `cloud_client` in `tests/e2e/cloud/conftest.py`, and the
    per-module app/session fixtures that request one of those. Owning the reset
    here means the truncate fires exactly for the tests whose fixture closure
    reaches the database. It used to run from an autouse fixture instead, so all
    2,973 collected tests paid it; only 1,057 of them ever open a connection, and
    truncating 79 tables twice around the other 1,916 is pure overhead.

    The reset itself is unchanged: `truncate_all_tables` before the test and
    again after it, on the same engine, over the same tables in the same order.
    """
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    await _cancel_test_background_tasks()
    await truncate_all_tables(engine)
    yield engine
    await _cancel_test_background_tasks()
    await truncate_all_tables(engine)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:  # type: ignore[no-untyped-def]
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(test_engine) -> AsyncGenerator[AsyncClient, None]:  # type: ignore[no-untyped-def]
    """Create a test client with a fresh DB for each test."""
    from proliferate.db import engine as engine_module
    from proliferate.main import create_app

    original_engine = engine_module.engine
    original_session_factory = engine_module.async_session_factory
    engine_module.engine = test_engine
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    app = create_app()

    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    engine_module.engine = original_engine
    engine_module.async_session_factory = original_session_factory
