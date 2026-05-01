import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
import proliferate.db.models.anonymous_telemetry  # noqa: F401
import proliferate.db.models.auth  # noqa: F401
import proliferate.db.models.automations  # noqa: F401
import proliferate.db.models.billing  # noqa: F401
import proliferate.db.models.cloud  # noqa: F401
from proliferate.db.models.base import Base

POSTGRES_USER = "proliferate"
POSTGRES_PASSWORD = "localdev"
POSTGRES_HOST = "127.0.0.1"
POSTGRES_PORT = 5432
TEST_DATABASE_NAME = os.environ.get(
    "PROLIFERATE_TEST_DATABASE_NAME",
    f"proliferate_test_{os.getpid()}",
)
ADMIN_DATABASE_URL = (
    f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@"
    f"{POSTGRES_HOST}:{POSTGRES_PORT}/postgres"
)
TEST_DATABASE_URL = (
    f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@"
    f"{POSTGRES_HOST}:{POSTGRES_PORT}/{TEST_DATABASE_NAME}"
)


def make_database_url(database_name: str) -> str:
    return (
        f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@"
        f"{POSTGRES_HOST}:{POSTGRES_PORT}/{database_name}"
    )


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


async def ensure_database_exists(database_name: str) -> None:
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as conn:
            result = await conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
                {"database_name": database_name},
            )
            if result.scalar() is None:
                await conn.execute(text(f"CREATE DATABASE {_quote_identifier(database_name)}"))
    finally:
        await admin_engine.dispose()


async def drop_database(database_name: str) -> None:
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as conn:
            await conn.execute(
                text(
                    """
                    SELECT pg_terminate_backend(pid)
                    FROM pg_stat_activity
                    WHERE datname = :database_name AND pid <> pg_backend_pid()
                    """
                ),
                {"database_name": database_name},
            )
            await conn.execute(text(f"DROP DATABASE IF EXISTS {_quote_identifier(database_name)}"))
    finally:
        await admin_engine.dispose()


def run_migrations(database_url: str) -> None:
    command.upgrade(build_alembic_config(database_url), "head")


async def run_migrations_async(database_url: str) -> None:
    await asyncio.to_thread(run_migrations, database_url)


async def truncate_all_tables(engine: AsyncEngine) -> None:
    table_names = [table.name for table in Base.metadata.sorted_tables]
    if not table_names:
        return

    quoted_table_names = ", ".join(_quote_identifier(table_name) for table_name in table_names)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE TABLE {quoted_table_names} RESTART IDENTITY CASCADE"))


@asynccontextmanager
async def temporary_database(prefix: str) -> AsyncIterator[tuple[str, str]]:
    database_name = f"{prefix}_{uuid.uuid4().hex}"
    await ensure_database_exists(database_name)
    try:
        yield database_name, make_database_url(database_name)
    finally:
        await drop_database(database_name)
