from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from proliferate.config import settings

SERVER_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI_PATH = SERVER_ROOT / "alembic.ini"
ALEMBIC_SCRIPT_PATH = SERVER_ROOT / "alembic"


def build_alembic_config(database_url: str | None = None) -> Config:
    config = Config(str(ALEMBIC_INI_PATH))
    config.set_main_option("script_location", str(ALEMBIC_SCRIPT_PATH))
    effective_database_url = database_url or settings.database_url
    config.attributes["proliferate_database_url"] = effective_database_url
    return config


def get_head_revision() -> str | None:
    return ScriptDirectory.from_config(build_alembic_config()).get_current_head()


def stamp_schema_head(sync_conn: Connection) -> None:
    sync_conn.exec_driver_sql(
        "CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL, "
        "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
    )
    sync_conn.execute(text("DELETE FROM alembic_version"))
    sync_conn.execute(
        text("INSERT INTO alembic_version (version_num) VALUES (:version_num)"),
        {"version_num": get_head_revision()},
    )


def validate_database_schema(sync_conn: Connection) -> None:
    head_revision = get_head_revision()
    current_revision = MigrationContext.configure(sync_conn).get_current_revision()
    if current_revision == head_revision:
        return

    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())
    if "alembic_version" not in table_names:
        detail = "missing alembic_version table"
    elif current_revision is None:
        detail = "database is not stamped with an Alembic revision"
    else:
        detail = (
            f"database revision {current_revision} does not match expected head {head_revision}"
        )

    raise RuntimeError(
        "Database schema is not up to date; "
        f"{detail}. Start the local Postgres container with `make server-db-up` and run "
        "`make server-migrate` before starting the API."
    )
