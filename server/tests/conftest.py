"""Shared test fixtures."""

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from tests.postgres import (
    TEST_DATABASE_NAME,
    TEST_DATABASE_URL,
    drop_database,
    ensure_database_exists,
    run_migrations,
    truncate_all_tables,
)


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
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def reset_test_database(test_engine) -> AsyncGenerator[None, None]:  # type: ignore[no-untyped-def]
    await truncate_all_tables(test_engine)
    yield
    await truncate_all_tables(test_engine)


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
