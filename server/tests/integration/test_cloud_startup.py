import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject


@pytest.mark.asyncio
async def test_app_startup_does_not_reconnect_cloud_sandboxes(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from proliferate.db import engine as engine_module
    from proliferate.main import create_app
    from proliferate.integrations.sandbox.e2b import E2BSandboxProvider

    async_session = async_sessionmaker(test_engine, expire_on_commit=False)
    async with async_session() as session:
        user = User(
            email=f"cloud-startup-{uuid.uuid4().hex[:8]}@example.com",
            hashed_password="unused-oauth-only",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Cloud Startup Tester",
        )
        session.add(user)
        await session.flush()
        await ensure_personal_billing_subject(session, user.id)

        sandbox = CloudSandbox(
            owner_user_id=user.id,
            provider_sandbox_id=f"sandbox-{uuid.uuid4()}",
            status=CloudSandboxStatus.paused,
            anyharness_base_url="https://example-runtime.invalid",
            runtime_token_ciphertext="ciphertext",
        )
        session.add(sandbox)
        await session.commit()

    async def _boom(*_args, **_kwargs) -> None:
        raise AssertionError("startup should not reconnect cloud sandboxes")

    monkeypatch.setattr(E2BSandboxProvider, "connect_running_sandbox", _boom)
    monkeypatch.setattr(E2BSandboxProvider, "resume_sandbox", _boom)

    engine_module.engine = test_engine
    engine_module.async_session_factory = async_session
    app = create_app()

    async with app.router.lifespan_context(app):
        pass


@pytest.mark.asyncio
@pytest.mark.parametrize("billing_mode", ["observe", "enforce"])
async def test_app_startup_fails_fast_when_e2b_billing_lacks_api_key(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    billing_mode: str,
) -> None:
    from proliferate.db import engine as engine_module
    from proliferate.main import create_app
    from proliferate.config import settings

    async_session = async_sessionmaker(test_engine, expire_on_commit=False)
    original_engine = engine_module.engine
    original_session_factory = engine_module.async_session_factory
    engine_module.engine = test_engine
    engine_module.async_session_factory = async_session

    try:
        monkeypatch.setattr(settings, "cloud_billing_mode", billing_mode)
        monkeypatch.setattr(settings, "e2b_api_key", "")

        app = create_app()

        with pytest.raises(RuntimeError, match="requires E2B_API_KEY"):
            async with app.router.lifespan_context(app):
                pass
    finally:
        engine_module.engine = original_engine
        engine_module.async_session_factory = original_session_factory


@pytest.mark.asyncio
async def test_app_startup_does_not_crash_when_production_e2b_template_is_unset(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # A previously-healthy base instance must NOT be replaced by a crash-looping
    # API just because E2B is half-configured (API key set, template missing).
    # Startup logs a warning and stays up; cloud-provisioning requests then fail
    # with an actionable error instead (see test_cloud_provisioning_config).
    from proliferate.db import engine as engine_module
    from proliferate.main import create_app
    from proliferate.config import settings

    async_session = async_sessionmaker(test_engine, expire_on_commit=False)
    original_engine = engine_module.engine
    original_session_factory = engine_module.async_session_factory
    engine_module.engine = test_engine
    engine_module.async_session_factory = async_session

    try:
        monkeypatch.setattr(settings, "debug", False)
        monkeypatch.setattr(settings, "e2b_api_key", "e2b_test_key")
        monkeypatch.setattr(settings, "e2b_template_name", "")
        # Billing must be off so its own (unchanged) E2B_API_KEY guard does not
        # short-circuit this test before the template check runs.
        monkeypatch.setattr(settings, "cloud_billing_mode", "off")

        app = create_app()

        # Lifespan completes without raising — the instance stays healthy.
        with caplog.at_level("WARNING", logger="proliferate.startup"):
            async with app.router.lifespan_context(app):
                pass

        assert any(
            "E2B_TEMPLATE_NAME" in record.message and record.levelname == "WARNING"
            for record in caplog.records
        )
    finally:
        engine_module.engine = original_engine
        engine_module.async_session_factory = original_session_factory
