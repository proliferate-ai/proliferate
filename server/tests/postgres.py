import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from alembic import command
from proliferate.db.migrations import build_alembic_config
import proliferate.db.models.anonymous_telemetry  # noqa: F401
import proliferate.db.models.analytics  # noqa: F401
import proliferate.db.models.auth  # noqa: F401
import proliferate.db.models.background  # noqa: F401
import proliferate.db.models.billing  # noqa: F401
import proliferate.db.models.organizations  # noqa: F401
from proliferate.db.models.base import Base

POSTGRES_USER = "proliferate"
POSTGRES_PASSWORD = "localdev"
POSTGRES_HOST = "127.0.0.1"
POSTGRES_PORT = 5432

# pytest-xdist runs every worker as its own OS process and exports the worker id
# ("gw0", "gw1", ...) into that process's environment before pytest imports any
# test module, so reading it at import time is safe. Naming the database after
# the worker is what makes the rest of the harness per-worker for free: the
# session-scoped ``migrated_test_database`` fixture is session-scoped *per
# process*, so each worker migrates and later drops only the database it owns,
# and the per-test TRUNCATE can never reach another worker's rows.
#
# A serial run (no ``-n``) sees an empty worker id and keeps the historical
# per-pid name byte-for-byte.
XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER", "")


def _default_test_database_name() -> str:
    if XDIST_WORKER:
        return f"proliferate_test_{XDIST_WORKER}_{os.getpid()}"
    return f"proliferate_test_{os.getpid()}"


def _resolve_test_database_name() -> str:
    explicit = os.environ.get("PROLIFERATE_TEST_DATABASE_NAME")
    if explicit is None:
        return _default_test_database_name()
    # An explicit override names one database. Under xdist it still has to fan
    # out, or the workers would truncate each other's rows mid-test.
    return f"{explicit}_{XDIST_WORKER}" if XDIST_WORKER else explicit


TEST_DATABASE_NAME = _resolve_test_database_name()
ADMIN_DATABASE_URL = (
    f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@"
    f"{POSTGRES_HOST}:{POSTGRES_PORT}/postgres"
)
TEST_DATABASE_URL = (
    f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@"
    f"{POSTGRES_HOST}:{POSTGRES_PORT}/{TEST_DATABASE_NAME}"
)

# CREATE DATABASE / DROP DATABASE take a lock on the template database, so
# concurrent creates from different xdist workers (or from ``temporary_database``
# inside a test) can lose that race with 55006 "is being accessed by other
# users" even though the database *names* never collide. 42P04/23505 mean
# someone else already created the name, which is the outcome we wanted anyway.
_DATABASE_EXISTS_SQLSTATES = frozenset({"42P04", "23505"})
_DATABASE_BUSY_SQLSTATES = frozenset({"55006"})
_DATABASE_LIFECYCLE_ATTEMPTS = 12


def make_database_url(database_name: str) -> str:
    return (
        f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@"
        f"{POSTGRES_HOST}:{POSTGRES_PORT}/{database_name}"
    )


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _sqlstate(error: BaseException) -> str | None:
    for candidate in (getattr(error, "orig", None), error):
        for attribute in ("sqlstate", "pgcode"):
            code = getattr(candidate, attribute, None)
            if isinstance(code, str):
                return code
    return None


async def ensure_database_exists(database_name: str) -> None:
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    try:
        for attempt in range(_DATABASE_LIFECYCLE_ATTEMPTS):
            try:
                async with admin_engine.connect() as conn:
                    result = await conn.execute(
                        text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
                        {"database_name": database_name},
                    )
                    if result.scalar() is not None:
                        return
                    await conn.execute(text(f"CREATE DATABASE {_quote_identifier(database_name)}"))
                    return
            except DBAPIError as error:
                sqlstate = _sqlstate(error)
                if sqlstate in _DATABASE_EXISTS_SQLSTATES:
                    return
                if (
                    sqlstate not in _DATABASE_BUSY_SQLSTATES
                    or attempt == _DATABASE_LIFECYCLE_ATTEMPTS - 1
                ):
                    raise
            await asyncio.sleep(0.25 * (attempt + 1))
    finally:
        await admin_engine.dispose()


async def drop_database(database_name: str) -> None:
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    try:
        for attempt in range(_DATABASE_LIFECYCLE_ATTEMPTS):
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
                    await conn.execute(
                        text(f"DROP DATABASE IF EXISTS {_quote_identifier(database_name)}")
                    )
                    return
            except DBAPIError as error:
                sqlstate = _sqlstate(error)
                if (
                    sqlstate not in _DATABASE_BUSY_SQLSTATES
                    or attempt == _DATABASE_LIFECYCLE_ATTEMPTS - 1
                ):
                    raise
            await asyncio.sleep(0.25 * (attempt + 1))
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
