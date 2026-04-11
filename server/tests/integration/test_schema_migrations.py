import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from proliferate.db import engine as engine_module
from proliferate.db.migrations import get_head_revision
from proliferate.db.models.base import Base
from proliferate.main import create_app
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


def _bootstrap_legacy_initial_schema(sync_conn) -> None:  # type: ignore[no-untyped-def]
    sync_conn.exec_driver_sql(
        """
        CREATE TABLE "user" (
            display_name VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL,
            id UUID PRIMARY KEY,
            email VARCHAR(320) NOT NULL,
            hashed_password VARCHAR(1024) NOT NULL,
            is_active BOOLEAN NOT NULL,
            is_superuser BOOLEAN NOT NULL,
            is_verified BOOLEAN NOT NULL
        )
        """
    )
    sync_conn.exec_driver_sql('CREATE UNIQUE INDEX ix_user_email ON "user" (email)')

    sync_conn.exec_driver_sql(
        """
        CREATE TABLE oauth_account (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            oauth_name VARCHAR(100) NOT NULL,
            access_token VARCHAR(1024) NOT NULL,
            expires_at INTEGER,
            refresh_token VARCHAR(1024),
            account_id VARCHAR(320) NOT NULL,
            account_email VARCHAR(320) NOT NULL
        )
        """
    )
    sync_conn.exec_driver_sql(
        "CREATE INDEX ix_oauth_account_account_id ON oauth_account (account_id)"
    )
    sync_conn.exec_driver_sql(
        "CREATE INDEX ix_oauth_account_oauth_name ON oauth_account (oauth_name)"
    )

    sync_conn.exec_driver_sql(
        """
        CREATE TABLE desktop_auth_code (
            id UUID PRIMARY KEY,
            code VARCHAR(128) NOT NULL,
            user_id UUID NOT NULL,
            code_challenge VARCHAR(128) NOT NULL,
            code_challenge_method VARCHAR(10) NOT NULL,
            state VARCHAR(128) NOT NULL,
            redirect_uri TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            consumed BOOLEAN NOT NULL
        )
        """
    )
    sync_conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ix_desktop_auth_code_code ON desktop_auth_code (code)"
    )

    sync_conn.exec_driver_sql(
        """
        CREATE TABLE cloud_workspace (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            display_name VARCHAR(255) NOT NULL,
            git_provider VARCHAR(32) NOT NULL,
            git_owner VARCHAR(255) NOT NULL,
            git_repo_name VARCHAR(255) NOT NULL,
            git_branch VARCHAR(255) NOT NULL,
            git_base_branch VARCHAR(255),
            status VARCHAR(32) NOT NULL,
            status_detail VARCHAR(255),
            last_error TEXT,
            template_version VARCHAR(64) NOT NULL,
            runtime_generation INTEGER NOT NULL,
            active_sandbox_id UUID,
            runtime_url TEXT,
            runtime_token_ciphertext TEXT,
            anyharness_data_key_ciphertext TEXT,
            anyharness_workspace_id VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            ready_at TIMESTAMPTZ,
            stopped_at TIMESTAMPTZ
        )
        """
    )
    sync_conn.exec_driver_sql(
        "CREATE INDEX ix_cloud_workspace_user_id ON cloud_workspace (user_id)"
    )

    sync_conn.exec_driver_sql(
        """
        CREATE TABLE cloud_sandbox (
            id UUID PRIMARY KEY,
            cloud_workspace_id UUID NOT NULL,
            provider VARCHAR(32) NOT NULL,
            external_sandbox_id VARCHAR(255) NOT NULL UNIQUE,
            status VARCHAR(32) NOT NULL,
            template_version VARCHAR(64) NOT NULL,
            started_at TIMESTAMPTZ,
            stopped_at TIMESTAMPTZ,
            last_heartbeat_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    sync_conn.exec_driver_sql(
        "CREATE INDEX ix_cloud_sandbox_cloud_workspace_id ON cloud_sandbox (cloud_workspace_id)"
    )

    sync_conn.exec_driver_sql(
        """
        CREATE TABLE cloud_credential (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            provider VARCHAR(32) NOT NULL,
            auth_mode VARCHAR(16) NOT NULL,
            payload_ciphertext TEXT NOT NULL,
            payload_format VARCHAR(32) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            last_synced_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ
        )
        """
    )
    sync_conn.exec_driver_sql(
        "CREATE INDEX ix_cloud_credential_user_id ON cloud_credential (user_id)"
    )


@pytest.fixture
def use_database_url():  # type: ignore[no-untyped-def]
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
                tables = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert tables >= {
                    "alembic_version",
                    "billing_entitlement",
                    "billing_grant",
                    "cloud_mcp_connection",
                    "cloud_credential",
                    "cloud_sandbox",
                    "cloud_workspace",
                    "desktop_auth_code",
                    "oauth_account",
                    "sandbox_event_receipt",
                    "usage_segment",
                    "user",
                }

                columns = await conn.run_sync(
                    lambda sync_conn: {
                        column["name"]
                        for column in inspect(sync_conn).get_columns("cloud_workspace")
                    }
                )
                assert "git_base_branch" in columns
                assert "anyharness_data_key_ciphertext" in columns

                version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version == HEAD_REVISION
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
async def test_alembic_upgrade_from_legacy_initial_revision() -> None:
    async with temporary_database("legacy_initial") as (_database_name, database_url):
        bootstrap_engine = create_async_engine(database_url, echo=False)
        try:
            async with bootstrap_engine.begin() as conn:
                await conn.run_sync(_bootstrap_legacy_initial_schema)
                await conn.run_sync(
                    lambda sync_conn: _set_alembic_revision(sync_conn, "0001_initial")
                )
        finally:
            await bootstrap_engine.dispose()

        await run_migrations_async(database_url)

        inspection_engine = create_async_engine(database_url, echo=False)
        try:
            async with inspection_engine.begin() as conn:
                version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version == HEAD_REVISION

                tables = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "billing_grant" in tables
                assert "billing_entitlement" in tables
                assert "cloud_mcp_connection" in tables
                assert "usage_segment" in tables
                assert "sandbox_event_receipt" in tables
        finally:
            await inspection_engine.dispose()


@pytest.mark.asyncio
async def test_alembic_upgrade_from_removed_c9_revision() -> None:
    async with temporary_database("removed_c9_revision") as (_database_name, database_url):
        bootstrap_engine = create_async_engine(database_url, echo=False)
        try:
            async with bootstrap_engine.begin() as conn:
                await conn.run_sync(_bootstrap_legacy_initial_schema)
                await conn.run_sync(
                    lambda sync_conn: _set_alembic_revision(sync_conn, "0001_initial")
                )
        finally:
            await bootstrap_engine.dispose()

        await run_migrations_async(database_url)

        stamped_engine = create_async_engine(database_url, echo=False)
        try:
            async with stamped_engine.begin() as conn:
                await conn.run_sync(
                    lambda sync_conn: _set_alembic_revision(sync_conn, "c9d8e7f6a5b4")
                )
        finally:
            await stamped_engine.dispose()

        await run_migrations_async(database_url)

        inspection_engine = create_async_engine(database_url, echo=False)
        try:
            async with inspection_engine.begin() as conn:
                version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version == HEAD_REVISION

                tables = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "cloud_workspace_mobility" in tables
                assert "cloud_workspace_handoff_op" in tables
                assert "cloud_mcp_connection" in tables
        finally:
            await inspection_engine.dispose()


@pytest.mark.asyncio
async def test_alembic_upgrade_from_removed_f4_revision() -> None:
    async with temporary_database("removed_f4_revision") as (_database_name, database_url):
        bootstrap_engine = create_async_engine(database_url, echo=False)
        try:
            async with bootstrap_engine.begin() as conn:
                await conn.run_sync(_bootstrap_legacy_initial_schema)
                await conn.run_sync(
                    lambda sync_conn: _set_alembic_revision(sync_conn, "0001_initial")
                )
        finally:
            await bootstrap_engine.dispose()

        await run_migrations_async(database_url)

        stamped_engine = create_async_engine(database_url, echo=False)
        try:
            async with stamped_engine.begin() as conn:
                await conn.run_sync(
                    lambda sync_conn: _set_alembic_revision(sync_conn, "f4e5d6c7b8a9")
                )
        finally:
            await stamped_engine.dispose()

        await run_migrations_async(database_url)

        inspection_engine = create_async_engine(database_url, echo=False)
        try:
            async with inspection_engine.begin() as conn:
                version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version == HEAD_REVISION

                tables = await conn.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                assert "cloud_workspace_mobility" not in tables
                assert "cloud_workspace_handoff_op" not in tables
                assert "cloud_mcp_connection" in tables
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
