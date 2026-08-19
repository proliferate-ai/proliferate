"""Alembic migration environment."""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import SchemaItem

import proliferate.db.models.analytics  # noqa: F401
import proliferate.db.models.anonymous_telemetry  # noqa: F401
import proliferate.db.models.auth  # noqa: F401
import proliferate.db.models.automations  # noqa: F401
import proliferate.db.models.background  # noqa: F401
import proliferate.db.models.billing  # noqa: F401
import proliferate.db.models.cloud  # noqa: F401
import proliferate.db.models.organizations  # noqa: F401
import proliferate.db.models.support  # noqa: F401
import proliferate.db.models.workflows  # noqa: F401
from alembic import context
from proliferate.config import settings
from proliferate.db.models.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

database_url = config.attributes.get("proliferate_database_url", settings.database_url)


def include_object(
    _object: SchemaItem,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to: SchemaItem | None,
) -> bool:
    # Remove this exact comparison exclusion only with the later,
    # release-separated forward migration that drops the rollback table.
    return not (
        type_ == "table"
        and name == "cloud_worktree_retention_policy"
        and reflected
        and compare_to is None
    )


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(
        database_url,
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
