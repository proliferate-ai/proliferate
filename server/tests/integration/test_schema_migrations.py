import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from alembic import command
from proliferate.db import engine as engine_module
from proliferate.db.migrations import build_alembic_config, get_head_revision
from proliferate.db.models.base import Base
from proliferate.main import create_app
from tests.integration.schema_migration_assertions import assert_current_schema
from tests.postgres import run_migrations_async, temporary_database

HEAD_REVISION = get_head_revision()


def _set_alembic_revision(sync_conn, revision: str) -> None:  # type: ignore[no-untyped-def]
    sync_conn.exec_driver_sql(
        "CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL, "
        "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
    )
    sync_conn.execute(text("DELETE FROM alembic_version"))
    sync_conn.execute(
        text("INSERT INTO alembic_version (version_num) VALUES (:version_num)"),
        {"version_num": revision},
    )


@pytest.fixture
async def use_database_url():  # type: ignore[no-untyped-def]
    original_engine = engine_module.engine
    original_factory = engine_module.async_session_factory

    async def _use(database_url: str):  # type: ignore[no-untyped-def]
        test_engine = create_async_engine(database_url, echo=False)
        engine_module.engine = test_engine
        engine_module.async_session_factory = async_sessionmaker(
            test_engine,
            expire_on_commit=False,
        )
        return test_engine

    yield _use

    engine_module.engine = original_engine
    engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_alembic_upgrade_creates_current_schema() -> None:
    async with temporary_database("migrations") as (_database_name, database_url):
        await run_migrations_async(database_url)
        inspection_engine = create_async_engine(database_url, echo=False)

        try:
            async with inspection_engine.begin() as conn:
                await assert_current_schema(conn, HEAD_REVISION)
        finally:
            await inspection_engine.dispose()


@pytest.mark.asyncio
async def test_alembic_upgrade_accepts_percent_encoded_database_url() -> None:
    async with temporary_database("migrations_percent_url") as (_database_name, database_url):
        url = make_url(database_url)
        assert url.password is not None
        encoded_password = f"%{ord(url.password[0]):02X}{url.password[1:]}"
        database_url_with_encoded_percent = database_url.replace(
            f":{url.password}@",
            f":{encoded_password}@",
            1,
        )

        await run_migrations_async(database_url_with_encoded_percent)

        inspection_engine = create_async_engine(database_url, echo=False)
        try:
            async with inspection_engine.begin() as conn:
                version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version == HEAD_REVISION
        finally:
            await inspection_engine.dispose()


@pytest.mark.asyncio
async def test_app_startup_succeeds_with_migrated_database(
    use_database_url,  # type: ignore[no-untyped-def]
) -> None:
    async with temporary_database("startup_ready") as (_database_name, database_url):
        await run_migrations_async(database_url)

        test_engine = await use_database_url(database_url)
        app = create_app()

        try:
            async with app.router.lifespan_context(app):
                transport = ASGITransport(app=app)  # type: ignore[arg-type]
                async with AsyncClient(transport=transport, base_url="http://test") as client:
                    response = await client.get("/health")

            assert response.status_code == 200
        finally:
            await test_engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("case_name", "revision"),
    [
        ("missing_version_table", None),
        ("stale_revision", "000000000000"),
    ],
)
async def test_app_startup_fails_when_database_is_not_migrated(
    use_database_url,  # type: ignore[no-untyped-def]
    case_name: str,
    revision: str | None,
) -> None:
    async with temporary_database(case_name) as (_database_name, database_url):
        bootstrap_engine = create_async_engine(database_url, echo=False)
        try:
            async with bootstrap_engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                if revision is not None:
                    await conn.run_sync(
                        lambda sync_conn: _set_alembic_revision(sync_conn, revision)
                    )
        finally:
            await bootstrap_engine.dispose()

        test_engine = await use_database_url(database_url)
        app = create_app()

        try:
            with pytest.raises(RuntimeError, match="make server-migrate"):
                async with app.router.lifespan_context(app):
                    pass
        finally:
            await test_engine.dispose()


@pytest.mark.asyncio
async def test_app_startup_fails_when_postgres_is_unreachable(
    use_database_url,  # type: ignore[no-untyped-def]
) -> None:
    database_url = (
        f"postgresql+asyncpg://proliferate:localdev@127.0.0.1:6543/unreachable_{uuid.uuid4().hex}"
    )
    test_engine = await use_database_url(database_url)
    app = create_app()

    try:
        with pytest.raises(RuntimeError, match="Could not connect to PostgreSQL"):
            async with app.router.lifespan_context(app):
                pass
    finally:
        await test_engine.dispose()


async def _upgrade_database_to_revision(database_url: str, revision: str) -> None:
    await command.upgrade(build_alembic_config(database_url), revision)
