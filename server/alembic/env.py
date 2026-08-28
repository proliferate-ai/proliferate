"""Alembic migration environment."""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

import proliferate.db.models.agent_auth_delivery  # noqa: F401
import proliferate.db.models.agent_gateway  # noqa: F401
import proliferate.db.models.analytics  # noqa: F401
import proliferate.db.models.anonymous_telemetry  # noqa: F401
import proliferate.db.models.auth  # noqa: F401
import proliferate.db.models.background  # noqa: F401
import proliferate.db.models.billing  # noqa: F401
import proliferate.db.models.github_app  # noqa: F401
import proliferate.db.models.integration_authorization  # noqa: F401
import proliferate.db.models.integration_revocation  # noqa: F401
import proliferate.db.models.integrations  # noqa: F401
import proliferate.db.models.organizations  # noqa: F401
import proliferate.db.models.repositories  # noqa: F401
import proliferate.db.models.runtime_workers  # noqa: F401
import proliferate.db.models.support  # noqa: F401
import proliferate.db.models.workflows  # noqa: F401
from alembic import context
from proliferate.config import settings
from proliferate.db.models.base import Base

config = context.config
if config.config_file_name is not None:
    # disable_existing_loggers defaults to True, which silently sets
    # `.disabled = True` on every logger that already exists at this point
    # and is not itself named in alembic.ini's [loggers] section -- forever,
    # for the life of the process, not just for the migration run. In the
    # test suite this reliably disabled `proliferate.auth.sign_in` (created
    # at import time by `proliferate.main` -> the desktop/identity auth
    # routers -> `sign_in_observability.py`) the moment any test imported
    # `proliferate.main` before the first migration ran in that pytest-xdist
    # worker, permanently silencing the sign-in SLI log line for every later
    # test in that worker (root-caused via PR #2181 CI: `test-integration`
    # shard 3, two caplog assertions failing with zero captured records
    # despite the log call demonstrably executing). False is the standard,
    # documented fix: apply alembic.ini's own logger configuration
    # additively instead of tearing down everything else already configured.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

database_url = config.attributes.get("proliferate_database_url", settings.database_url)


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
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
