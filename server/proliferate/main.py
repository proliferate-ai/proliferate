"""Proliferate API — FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

import proliferate.db.models.anonymous_telemetry  # noqa: F401
import proliferate.db.models.automations  # noqa: F401
import proliferate.db.models.cloud  # noqa: F401
from proliferate.auth.dependencies import fastapi_users
from proliferate.auth.desktop.api import router as desktop_router
from proliferate.auth.jwt import auth_backend
from proliferate.auth.models import UserRead, UserUpdate
from proliferate.auth.oauth import github_oauth_client
from proliferate.config import get_cors_allow_origins, settings
from proliferate.constants.app import APP_NAME
from proliferate.db import engine as db_engine
from proliferate.db.migrations import validate_database_schema
from proliferate.integrations.anonymous_telemetry import (
    start_server_anonymous_telemetry_sender,
    stop_server_anonymous_telemetry_sender,
)
from proliferate.integrations.sentry import flush_server_sentry, init_server_sentry
from proliferate.middleware.request_context import RequestContextMiddleware
from proliferate.middleware.request_telemetry import RequestTelemetryMiddleware
from proliferate.server.ai_magic.api import router as ai_magic_router
from proliferate.server.anonymous_telemetry.api import router as anonymous_telemetry_router
from proliferate.server.artifact_runtime.api import router as artifact_runtime_router
from proliferate.server.automations.api import router as automations_router
from proliferate.server.billing.api import router as billing_router
from proliferate.server.billing.reconciler import (
    start_billing_reconciler,
    stop_billing_reconciler,
)
from proliferate.server.cloud.api import router as cloud_router
from proliferate.server.health import router as health_router
from proliferate.server.support.api import router as support_router
from proliferate.utils.logging import configure_server_logging


def _normalize_api_prefix(raw_prefix: str) -> str:
    if not raw_prefix or raw_prefix == "/":
        return ""
    normalized = raw_prefix.strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return normalized.rstrip("/")


def _validate_cloud_billing_configuration() -> None:
    billing_mode = settings.cloud_billing_mode
    if billing_mode == "off":
        return
    if settings.sandbox_provider != "e2b":
        if billing_mode == "enforce":
            raise RuntimeError(
                "cloud_billing_mode=enforce currently requires sandbox_provider=e2b."
            )
        return
    if not settings.e2b_api_key:
        raise RuntimeError(
            f"cloud_billing_mode={billing_mode} with sandbox_provider=e2b requires "
            "E2B_API_KEY so metering and reconciliation can run."
        )


def _validate_e2b_template_configuration() -> None:
    if settings.sandbox_provider != "e2b":
        return
    if settings.debug:
        return
    if not settings.e2b_api_key:
        return
    if settings.e2b_template_name.strip():
        return
    raise RuntimeError(
        "sandbox_provider=e2b with E2B_API_KEY set requires E2B_TEMPLATE_NAME in "
        "non-debug environments so cloud provisioning uses the published runtime "
        "template instead of the base E2B image."
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _validate_cloud_billing_configuration()
    _validate_e2b_template_configuration()
    try:
        async with db_engine.engine.begin() as conn:
            await conn.run_sync(validate_database_schema)
    except RuntimeError:
        raise
    except (OSError, SQLAlchemyError) as exc:
        raise RuntimeError(
            "Could not connect to PostgreSQL for the control plane. "
            "Start the local Postgres container with `make server-db-up` and run "
            "`make server-migrate` before starting the API."
        ) from exc
    if settings.sandbox_provider == "e2b" and settings.cloud_billing_mode in {
        "observe",
        "enforce",
    }:
        start_billing_reconciler()
    anonymous_telemetry_task = await start_server_anonymous_telemetry_sender()
    try:
        yield
    finally:
        await stop_server_anonymous_telemetry_sender(anonymous_telemetry_task)
        await stop_billing_reconciler()
        flush_server_sentry()


def create_app() -> FastAPI:
    configure_server_logging()
    init_server_sentry()
    api_prefix = _normalize_api_prefix(settings.api_path_prefix)

    app = FastAPI(
        title=APP_NAME,
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_allow_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestTelemetryMiddleware)
    app.add_middleware(RequestContextMiddleware)

    # ── Auth: users/me (read-only profile) ──
    app.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate),
        prefix=f"{api_prefix}/users",
        tags=["users"],
    )

    # ── Auth: GitHub OAuth (browser-based, via fastapi-users) ──
    if settings.github_oauth_client_id and settings.github_oauth_client_secret:
        app.include_router(
            fastapi_users.get_oauth_router(
                github_oauth_client,
                auth_backend,
                state_secret=settings.jwt_secret,
            ),
            prefix=f"{api_prefix}/auth/github",
            tags=["auth"],
        )

    # ── Auth: Desktop PKCE flow ──
    app.include_router(desktop_router, prefix=f"{api_prefix}/auth", tags=["auth"])

    # ── Domain routes ──
    app.include_router(health_router, prefix=api_prefix, tags=["health"])
    app.include_router(artifact_runtime_router, prefix=api_prefix, tags=["artifact_runtime"])
    app.include_router(
        anonymous_telemetry_router,
        prefix=f"{api_prefix}/v1",
        tags=["anonymous_telemetry"],
    )
    app.include_router(cloud_router, prefix=f"{api_prefix}/v1", tags=["cloud"])
    app.include_router(ai_magic_router, prefix=f"{api_prefix}/v1", tags=["ai_magic"])
    app.include_router(support_router, prefix=f"{api_prefix}/v1", tags=["support"])
    app.include_router(billing_router, prefix=f"{api_prefix}/v1", tags=["billing"])
    app.include_router(automations_router, prefix=f"{api_prefix}/v1", tags=["automations"])

    return app


app = create_app()
