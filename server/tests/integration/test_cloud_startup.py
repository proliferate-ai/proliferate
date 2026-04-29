import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db.models.cloud import (
    CloudSandbox,
    CloudWorkspace,
)
from proliferate.db.store.billing import ensure_personal_billing_subject


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
        user_id = uuid.uuid4()
        billing_subject = await ensure_personal_billing_subject(session, user_id)
        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            created_by_user_id=user_id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="ready",
            status_detail="Ready",
            last_error=None,
            template_version="v1",
            runtime_generation=1,
            runtime_url="https://example-runtime.invalid",
            runtime_token_ciphertext="ciphertext",
            anyharness_workspace_id="workspace-123",
        )
        session.add(workspace)
        await session.commit()
        await session.refresh(workspace)

        sandbox = CloudSandbox(
            cloud_workspace_id=workspace.id,
            provider="e2b",
            external_sandbox_id=f"sandbox-{uuid.uuid4()}",
            status="paused",
            template_version="v1",
        )
        session.add(sandbox)
        await session.commit()

        workspace.active_sandbox_id = sandbox.id
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
        monkeypatch.setattr(settings, "sandbox_provider", "e2b")
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
async def test_app_startup_fails_fast_when_production_e2b_template_is_unset(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
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
        monkeypatch.setattr(settings, "debug", False)
        monkeypatch.setattr(settings, "sandbox_provider", "e2b")
        monkeypatch.setattr(settings, "e2b_api_key", "e2b_test_key")
        monkeypatch.setattr(settings, "e2b_template_name", "")

        app = create_app()

        with pytest.raises(RuntimeError, match="requires E2B_TEMPLATE_NAME"):
            async with app.router.lifespan_context(app):
                pass
    finally:
        engine_module.engine = original_engine
        engine_module.async_session_factory = original_session_factory
