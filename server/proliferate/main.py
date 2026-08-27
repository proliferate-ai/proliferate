"""Proliferate API — FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

# Retained automation tables must stay registered in SQLAlchemy metadata.
import proliferate.db.models.agent_gateway  # noqa: F401
import proliferate.db.models.analytics  # noqa: F401
import proliferate.db.models.anonymous_telemetry  # noqa: F401
import proliferate.db.models.auth  # noqa: F401
import proliferate.db.models.github_app  # noqa: F401
import proliferate.db.models.integration_authorization  # noqa: F401
import proliferate.db.models.integration_revocation  # noqa: F401
import proliferate.db.models.integrations  # noqa: F401
import proliferate.db.models.organizations  # noqa: F401
import proliferate.db.models.repositories  # noqa: F401
import proliferate.db.models.runtime_workers  # noqa: F401
import proliferate.db.models.support  # noqa: F401
import proliferate.db.models.workflows  # noqa: F401
from proliferate.auth.api import router as auth_viewer_router
from proliferate.auth.errors import AuthFlowError
from proliferate.auth.profile_api import router as user_profile_router
from proliferate.config import get_cors_allow_origins, settings
from proliferate.constants.app import APP_NAME
from proliferate.db import engine as db_engine
from proliferate.db.migrations import validate_database_schema
from proliferate.errors import ProliferateError
from proliferate.integrations.sentry import flush_server_sentry, init_server_sentry
from proliferate.lib.product.telemetry.mode import (
    get_server_telemetry_mode,
    is_vendor_telemetry_enabled,
)
from proliferate.middleware.logging import configure_server_logging
from proliferate.middleware.request_context import RequestContextMiddleware
from proliferate.middleware.request_telemetry import RequestTelemetryMiddleware
from proliferate.server.accounts.desktop.api import router as desktop_router
from proliferate.server.accounts.identity.api import router as identity_auth_router
from proliferate.server.agent_auth.api import gateway_account_router as agent_gateway_router
from proliferate.server.agent_auth.api import organization_router as agent_auth_organization_router
from proliferate.server.agent_auth.api import router as agent_auth_router
from proliferate.server.agent_auth.worker import (
    start_agent_gateway_enrollment_backfill,
    start_agent_gateway_llm_topups,
    start_agent_gateway_usage_import,
    start_agent_gateway_verification,
    start_agent_seat_usage_probe,
    stop_agent_gateway_enrollment_backfill,
    stop_agent_gateway_llm_topups,
    stop_agent_gateway_usage_import,
    stop_agent_gateway_verification,
    stop_agent_seat_usage_probe,
)
from proliferate.server.ai_magic.api import router as ai_magic_router
from proliferate.server.analytics.api import router as analytics_router
from proliferate.server.anonymous_telemetry.api import router as anonymous_telemetry_router
from proliferate.server.anonymous_telemetry.worker import (
    start_server_anonymous_telemetry_sender,
    stop_server_anonymous_telemetry_sender,
)
from proliferate.server.artifact_runtime.api import router as artifact_runtime_router
from proliferate.server.billing.api import router as billing_router
from proliferate.server.catalogs.api import router as catalogs_router
from proliferate.server.devtools.api import router as devtools_router
from proliferate.server.github.api import callback_router as github_app_callback_router
from proliferate.server.github.api import organization_router as github_app_organization_router
from proliferate.server.github.api import router as github_app_router
from proliferate.server.github.api import (
    setup_callback_router as github_app_setup_callback_router,
)
from proliferate.server.github.api import webhook_router as github_webhook_router
from proliferate.server.github.repos.api import router as repos_router
from proliferate.server.health import router as health_router
from proliferate.server.integration_gateway.connections.api import (
    admin_router as integrations_admin_router,
)
from proliferate.server.integration_gateway.connections.api import router as integrations_router
from proliferate.server.integration_gateway.connections.seeds import sync_seed_definitions
from proliferate.server.integration_gateway.gateway.api import router as integration_gateway_router
from proliferate.server.meta import router as meta_router
from proliferate.server.organizations.api import router as organizations_router
from proliferate.server.organizations.join_api import router as organization_join_router
from proliferate.server.organizations.registration_api import router as self_registration_router
from proliferate.server.organizations.registration_pages import (
    router as registration_pages_router,
)
from proliferate.server.organizations.usage.api import router as organization_usage_router
from proliferate.server.release import resolve_server_release_id
from proliferate.server.repositories.api import router as repositories_router
from proliferate.server.seam.workers.api import admin_router as runtime_workers_admin_router
from proliferate.server.seam.workers.api import router as runtime_workers_router
from proliferate.server.seam.workers.api import worker_router as runtime_worker_router
from proliferate.server.setup.api import router as first_run_setup_router
from proliferate.server.setup.lifecycle import ensure_first_run_setup_token
from proliferate.server.support.api import router as support_router
from proliferate.server.version import server_version
from proliferate.server.web_app import mount_web_app
from proliferate.server.workflows.api import invocations_router as workflow_invocations_router
from proliferate.server.workflows.api import router as workflows_router


def _cloud_compat_router() -> APIRouter:
    """Kept systems that still serve under the historical ``/v1/cloud`` prefix.

    The extracted systems' wire paths are part of installed clients, GitHub App
    settings, and the generated SDK; the prefix stays until those consumers move.
    """
    router = APIRouter(prefix="/cloud", tags=["cloud"])
    router.include_router(repos_router)
    router.include_router(repositories_router)
    router.include_router(github_app_router)
    router.include_router(github_app_organization_router)
    router.include_router(agent_auth_router)
    router.include_router(agent_auth_organization_router)
    router.include_router(agent_gateway_router)
    router.include_router(runtime_workers_router)
    router.include_router(runtime_worker_router)
    router.include_router(runtime_workers_admin_router)
    router.include_router(integration_gateway_router)
    router.include_router(integrations_router)
    router.include_router(integrations_admin_router)
    router.include_router(github_webhook_router)
    return router


def _normalize_api_prefix(raw_prefix: str) -> str:
    if not raw_prefix or raw_prefix == "/":
        return ""
    normalized = raw_prefix.strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return normalized.rstrip("/")


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
    # The agent-auth key routes accept a raw key value in the body — either
    # directly (POST .../agent-auth/keys) or nested under a typed
    # provider-config document (POST .../agent-auth/keys/provider-config,
    # e.g. azure_openai's value.apiKey). Match the whole subtree by
    # substring rather than endswith("/keys") so provider-config (and any
    # future .../keys/<suffix> route) is covered too; no other route in the
    # app contains "/agent-auth/keys" (verified via git grep), so this stays
    # scoped to this one endpoint family regardless of self-host api-prefix.
    return request.method == "POST" and "/agent-auth/keys" in request.url.path


def _is_workflow_invocation_put(request: Request) -> bool:
    return request.method == "PUT" and "/workflow-invocations/" in request.url.path


def _is_workflow_invocation_argument_error(request: Request, loc: object) -> bool:
    if not _is_workflow_invocation_put(request):
        return False
    if not isinstance(loc, tuple | list):
        return False
    return len(loc) >= 2 and loc[0] == "body" and "arguments" in loc[1:]


def _redact_workflow_invocation_arguments(value: object) -> object:
    """Blank the arguments subtree wherever it appears in an echoed input.

    A union request body makes pydantic echo the whole submitted document on
    branch-level errors, so loc-based matching alone no longer catches every
    place an argument value can surface.
    """

    if isinstance(value, dict):
        return {
            key: (
                _REDACTED_INPUT
                if key == "arguments"
                else _redact_workflow_invocation_arguments(child)
            )
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [_redact_workflow_invocation_arguments(child) for child in value]
    return value


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
            if (
                redact_all
                or (loc and _is_sensitive_field(loc[-1]))
                or _is_workflow_invocation_argument_error(request, loc)
            ):
                item["input"] = _REDACTED_INPUT
            else:
                redacted = _redact_validation_input(item["input"])
                if _is_workflow_invocation_put(request):
                    redacted = _redact_workflow_invocation_arguments(redacted)
                item["input"] = redacted
        errors.append(item)
    return JSONResponse(status_code=422, content=jsonable_encoder({"detail": errors}))


async def _proliferate_error_handler(
    _request: Request,
    error: ProliferateError,
) -> JSONResponse:
    if isinstance(error, AuthFlowError):
        detail: str | dict[str, object] = error.message
    else:
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
    # The periodic maintenance loops below no-op when
    # settings.run_background_workers is false (deterministic billing tests
    # drive these same passes on demand out-of-process).
    anonymous_telemetry_task = await start_server_anonymous_telemetry_sender()
    agent_gateway_backfill_task = await start_agent_gateway_enrollment_backfill()
    agent_gateway_usage_import_task = await start_agent_gateway_usage_import()
    agent_gateway_topup_task = await start_agent_gateway_llm_topups()
    agent_gateway_verification_task = await start_agent_gateway_verification()
    agent_seat_usage_probe_task = await start_agent_seat_usage_probe()
    try:
        yield
    finally:
        await stop_agent_seat_usage_probe(agent_seat_usage_probe_task)
        await stop_agent_gateway_verification(agent_gateway_verification_task)
        await stop_agent_gateway_llm_topups(agent_gateway_topup_task)
        await stop_agent_gateway_usage_import(agent_gateway_usage_import_task)
        await stop_agent_gateway_enrollment_backfill(agent_gateway_backfill_task)
        await stop_server_anonymous_telemetry_sender(anonymous_telemetry_task)
        flush_server_sentry()


def create_app() -> FastAPI:
    configure_server_logging()
    init_server_sentry(
        enabled=is_vendor_telemetry_enabled(),
        telemetry_mode=get_server_telemetry_mode(),
        release_resolver=lambda: resolve_server_release_id(settings.sentry_release),
    )
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
    app.include_router(_cloud_compat_router(), prefix=f"{api_prefix}/v1", tags=["cloud"])
    app.include_router(catalogs_router, prefix=f"{api_prefix}/v1", tags=["catalogs"])
    app.include_router(workflows_router, prefix=f"{api_prefix}/v1", tags=["workflows"])
    app.include_router(
        workflow_invocations_router,
        prefix=f"{api_prefix}/v1",
        tags=["workflow-invocations"],
    )
    app.include_router(ai_magic_router, prefix=f"{api_prefix}/v1", tags=["ai_magic"])
    app.include_router(support_router, prefix=f"{api_prefix}/v1", tags=["support"])
    app.include_router(billing_router, prefix=f"{api_prefix}/v1", tags=["billing"])
    app.include_router(organizations_router, prefix=f"{api_prefix}/v1", tags=["organizations"])
    app.include_router(
        organization_usage_router,
        prefix=f"{api_prefix}/v1",
        tags=["organizations"],
    )
    app.include_router(devtools_router, prefix=f"{api_prefix}/v1", tags=["devtools"])

    # Serve the compiled ProductClient Web application (self-hosted Web) after
    # every API/auth/setup route is registered, so the fail-closed SPA fallback
    # only catches genuinely unmatched browser navigation. No-op when
    # WEB_DIST_DIR is empty (API-only).
    mount_web_app(app, settings.web_dist_dir, api_prefix)

    return app


app = create_app()
