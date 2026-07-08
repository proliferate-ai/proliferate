"""Proliferate API — FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

import proliferate.db.models.analytics  # noqa: F401
import proliferate.db.models.anonymous_telemetry  # noqa: F401
import proliferate.db.models.auth  # noqa: F401
import proliferate.db.models.automations  # noqa: F401
import proliferate.db.models.cloud  # noqa: F401
import proliferate.db.models.organizations  # noqa: F401
import proliferate.db.models.support  # noqa: F401
from proliferate.auth.api import router as auth_viewer_router
from proliferate.auth.desktop.api import router as desktop_router
from proliferate.auth.identity.api import router as identity_auth_router
from proliferate.auth.profile_api import router as user_profile_router
from proliferate.auth.sso.api import router as sso_auth_router
from proliferate.config import get_cors_allow_origins, settings
from proliferate.constants.app import APP_NAME
from proliferate.db import engine as db_engine
from proliferate.db.migrations import validate_database_schema
from proliferate.errors import ProliferateError
from proliferate.integrations.sentry import flush_server_sentry, init_server_sentry
from proliferate.middleware.request_context import RequestContextMiddleware
from proliferate.middleware.request_telemetry import RequestTelemetryMiddleware
from proliferate.server.ai_magic.api import router as ai_magic_router
from proliferate.server.analytics.api import router as analytics_router
from proliferate.server.anonymous_telemetry.api import router as anonymous_telemetry_router
from proliferate.server.anonymous_telemetry.worker import (
    start_server_anonymous_telemetry_sender,
    stop_server_anonymous_telemetry_sender,
)
from proliferate.server.artifact_runtime.api import router as artifact_runtime_router

# AUTOMATIONS PARKED: retarget to RepoEnvironment in a later PR before remounting.
# from proliferate.server.automations.api import router as automations_router
from proliferate.server.billing.api import router as billing_router
from proliferate.server.billing.reconciler import (
    start_billing_reconciler,
    stop_billing_reconciler,
)
from proliferate.server.catalogs.api import router as catalogs_router
from proliferate.server.cloud.agent_gateway.worker import (
    start_agent_gateway_enrollment_backfill,
    start_agent_gateway_llm_topups,
    start_agent_gateway_usage_import,
    stop_agent_gateway_enrollment_backfill,
    stop_agent_gateway_llm_topups,
    stop_agent_gateway_usage_import,
)
from proliferate.server.cloud.api import router as cloud_router
from proliferate.server.cloud.gateway.api import router as gateway_router
from proliferate.server.cloud.github_app.api import callback_router as github_app_callback_router
from proliferate.server.cloud.github_app.api import (
    setup_callback_router as github_app_setup_callback_router,
)
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.server.devtools.api import router as devtools_router
from proliferate.server.health import router as health_router
from proliferate.server.meta import router as meta_router
from proliferate.server.organizations.api import router as organizations_router
from proliferate.server.organizations.join_api import router as organization_join_router
from proliferate.server.organizations.registration_api import router as self_registration_router
from proliferate.server.organizations.registration_pages import (
    router as registration_pages_router,
)
from proliferate.server.organizations.sso.api import router as organization_sso_router
from proliferate.server.organizations.usage.api import router as organization_usage_router
from proliferate.server.setup.api import router as first_run_setup_router
from proliferate.server.setup.lifecycle import ensure_first_run_setup_token
from proliferate.server.support.api import router as support_router
from proliferate.server.version import server_version
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
    if not settings.e2b_api_key:
        raise RuntimeError(
            f"cloud_billing_mode={billing_mode} requires "
            "E2B_API_KEY so metering and reconciliation can run."
        )


def _validate_e2b_template_configuration() -> None:
    if settings.debug:
        return
    if not settings.e2b_api_key:
        return
    if settings.e2b_template_name.strip():
        return
    raise RuntimeError(
        "E2B_API_KEY set requires E2B_TEMPLATE_NAME in "
        "non-debug environments so cloud provisioning uses the published runtime "
        "template instead of the base E2B image."
    )


# Fragments that mark a request-body field as secret-bearing. FastAPI's default
# 422 handler echoes the offending input verbatim, so a single unrelated invalid
# field (e.g. a missing displayName) would otherwise reflect the whole body —
# including a plaintext API-key secret — back to the caller.
_SENSITIVE_INPUT_FRAGMENTS = ("secret", "password", "token", "payload", "ciphertext")
_REDACTED_INPUT = "[redacted]"


def _is_sensitive_field(key: object) -> bool:
    return isinstance(key, str) and any(
        fragment in key.lower() for fragment in _SENSITIVE_INPUT_FRAGMENTS
    )


def _redact_validation_input(value: object) -> object:
    if isinstance(value, dict):
        return {
            key: (_REDACTED_INPUT if _is_sensitive_field(key) else _redact_validation_input(child))
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [_redact_validation_input(child) for child in value]
    return value


def _redacts_entire_body(request: Request) -> bool:
    # The agent-gateway key-create endpoint accepts a raw key value in the body;
    # redact its echoed input wholesale so no malformed shape can leak it.
    return request.method == "POST" and request.url.path.endswith("/agent-gateway/keys")


async def _validation_error_handler(
    request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    redact_all = _redacts_entire_body(request)
    errors: list[dict[str, object]] = []
    for raw in error.errors():
        item = dict(raw)
        if "input" in item:
            loc = item.get("loc") or ()
            if redact_all or (loc and _is_sensitive_field(loc[-1])):
                item["input"] = _REDACTED_INPUT
            else:
                item["input"] = _redact_validation_input(item["input"])
        errors.append(item)
    return JSONResponse(status_code=422, content=jsonable_encoder({"detail": errors}))


async def _proliferate_error_handler(
    _request: Request,
    error: ProliferateError,
) -> JSONResponse:
    detail = {
        "code": error.code,
        "message": error.message,
    }
    extra_detail = getattr(error, "extra_detail", None)
    if isinstance(extra_detail, dict):
        detail.update(extra_detail)
    return JSONResponse(
        status_code=error.status_code,
        content={"detail": detail},
        headers=getattr(error, "headers", None),
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
    # Single-org mode only (no-op otherwise): mint the first-run setup token
    # while the user table is empty, or clean it up once the instance is
    # claimed.
    await ensure_first_run_setup_token()
    # Reconcile the built-in integration seed definitions into the database.
    async with db_engine.async_session_factory() as db, db.begin():
        await sync_seed_definitions(db)
    if settings.cloud_billing_mode in {"observe", "enforce"}:
        start_billing_reconciler()
    anonymous_telemetry_task = await start_server_anonymous_telemetry_sender()
    agent_gateway_backfill_task = await start_agent_gateway_enrollment_backfill()
    agent_gateway_usage_import_task = await start_agent_gateway_usage_import()
    agent_gateway_topup_task = await start_agent_gateway_llm_topups()
    try:
        yield
    finally:
        await stop_agent_gateway_llm_topups(agent_gateway_topup_task)
        await stop_agent_gateway_usage_import(agent_gateway_usage_import_task)
        await stop_agent_gateway_enrollment_backfill(agent_gateway_backfill_task)
        await stop_server_anonymous_telemetry_sender(anonymous_telemetry_task)
        await stop_billing_reconciler()
        flush_server_sentry()


def create_app() -> FastAPI:
    configure_server_logging()
    init_server_sentry()
    api_prefix = _normalize_api_prefix(settings.api_path_prefix)

    app = FastAPI(
        title=APP_NAME,
        version=server_version(),
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
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(ProliferateError, _proliferate_error_handler)

    # ── Auth: users/me (read-only profile) ──
    app.include_router(user_profile_router, prefix=api_prefix)

    # ── Auth: Desktop PKCE flow ──
    app.include_router(desktop_router, prefix=f"{api_prefix}/auth", tags=["auth"])
    # SSO routes use literal `sso`/`oidc` path segments and must be registered before
    # the generic identity `/{surface}/{provider}/start` and `/{provider}/callback`
    # routes, which would otherwise shadow them (capturing `sso`/`oidc` as `{provider}`).
    app.include_router(sso_auth_router, prefix=f"{api_prefix}/auth", tags=["auth"])
    app.include_router(github_app_callback_router, prefix=f"{api_prefix}/auth", tags=["auth"])
    app.include_router(github_app_setup_callback_router, prefix=api_prefix, tags=["auth"])
    app.include_router(identity_auth_router, prefix=f"{api_prefix}/auth", tags=["auth"])
    app.include_router(auth_viewer_router, prefix=f"{api_prefix}/v1", tags=["auth"])

    # ── Domain routes ──
    app.include_router(health_router, prefix=api_prefix, tags=["health"])
    app.include_router(meta_router, prefix=api_prefix, tags=["meta"])
    if settings.single_org_mode:
        # First-run claim page. Exists only in single-org deployments; hosted
        # production never mounts it, and it 404s once the instance is claimed.
        app.include_router(first_run_setup_router, prefix=api_prefix, tags=["setup"])
        # Invited self-registration (invite-as-allowlist). Single-org only:
        # hosted deployments never expose password registration.
        app.include_router(self_registration_router, prefix=f"{api_prefix}/auth", tags=["auth"])
        # Server-rendered /register page: the HTML sibling of the registration
        # route above, for the invite link an admin shares with a teammate.
        app.include_router(registration_pages_router, prefix=api_prefix, tags=["auth"])
    app.include_router(organization_join_router, prefix=api_prefix, tags=["organizations"])
    app.include_router(artifact_runtime_router, prefix=api_prefix, tags=["artifact_runtime"])
    app.include_router(
        anonymous_telemetry_router,
        prefix=f"{api_prefix}/v1",
        tags=["anonymous_telemetry"],
    )
    app.include_router(analytics_router, prefix=f"{api_prefix}/v1", tags=["analytics"])
    app.include_router(cloud_router, prefix=f"{api_prefix}/v1", tags=["cloud"])
    app.include_router(gateway_router, prefix=f"{api_prefix}/v1/gateway", tags=["gateway"])
    app.include_router(catalogs_router, prefix=f"{api_prefix}/v1", tags=["catalogs"])
    app.include_router(ai_magic_router, prefix=f"{api_prefix}/v1", tags=["ai_magic"])
    app.include_router(support_router, prefix=f"{api_prefix}/v1", tags=["support"])
    app.include_router(billing_router, prefix=f"{api_prefix}/v1", tags=["billing"])
    app.include_router(organizations_router, prefix=f"{api_prefix}/v1", tags=["organizations"])
    app.include_router(
        organization_sso_router,
        prefix=f"{api_prefix}/v1",
        tags=["organizations"],
    )
    app.include_router(
        organization_usage_router,
        prefix=f"{api_prefix}/v1",
        tags=["organizations"],
    )
    # AUTOMATIONS PARKED: /v1/automations/* is intentionally disabled until the
    # domain is retargeted from deleted cloud_repo_config rows to RepoEnvironment.
    # app.include_router(automations_router, prefix=f"{api_prefix}/v1", tags=["automations"])
    app.include_router(devtools_router, prefix=f"{api_prefix}/v1", tags=["devtools"])

    return app


app = create_app()
