"""Sentry SDK lifecycle and validated public ingress for the Server.

Only this package may import or use ``sentry_sdk`` in Server production code.
Every public entry point validates its original Python input against the closed
catalogs in :mod:`.privacy` before any SDK call.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

try:
    import sentry_sdk
    from sentry_sdk.integrations.atexit import AtexitIntegration
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.dedupe import DedupeIntegration
    from sentry_sdk.integrations.excepthook import ExcepthookIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.threading import ThreadingIntegration
except ImportError:  # pragma: no cover - optional dependency in local/test envs
    sentry_sdk = None
    AtexitIntegration = None
    CeleryIntegration = None
    DedupeIntegration = None
    ExcepthookIntegration = None
    FastApiIntegration = None
    LoggingIntegration = None
    StarletteIntegration = None
    ThreadingIntegration = None

from proliferate.config import settings

from .privacy import (
    EVENT_LEVELS,
    EXTRA_VALIDATORS,
    TAG_VALIDATORS,
    _project_breadcrumb,
    _project_outbound_event,
    environment_value,
    project_extra_value,
)
from .scalars import canonical_uuid, release_value

_sentry_initialized = False
_report_critical_logger = logging.getLogger("proliferate.critical")


def _build_integrations() -> list[Any]:
    return [
        AtexitIntegration(),
        CeleryIntegration(propagate_traces=False, monitor_beat_tasks=False),
        DedupeIntegration(),
        ExcepthookIntegration(always_run=False),
        LoggingIntegration(level=logging.INFO, event_level=None),
        ThreadingIntegration(propagate_scope=True),
        StarletteIntegration(transaction_style="endpoint", middleware_spans=False),
        FastApiIntegration(transaction_style="endpoint", middleware_spans=False),
    ]


def init_server_sentry(
    *,
    enabled: bool,
    telemetry_mode: str,
    release_resolver: Callable[[], str],
) -> None:
    global _sentry_initialized

    if type(enabled) is not bool or not enabled or telemetry_mode != "hosted_product":
        return
    if _sentry_initialized or not settings.sentry_dsn or sentry_sdk is None:
        return

    _sentry_initialized = True

    release = release_value(release_resolver()) or ""
    environment = environment_value(settings.sentry_environment) or ""

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        release=release,
        environment=environment,
        attach_stacktrace=True,
        max_breadcrumbs=100,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=_build_integrations(),
        before_send=_project_outbound_event,
        before_send_transaction=_project_outbound_event,
        before_breadcrumb=_project_breadcrumb,
        default_integrations=False,
        auto_enabling_integrations=False,
        trace_lifecycle="static",
        propagate_traces=False,
        trace_propagation_targets=[],
        include_local_variables=False,
        include_source_context=False,
        max_request_body_size="never",
        send_default_pii=False,
        auto_session_tracking=False,
        send_client_reports=False,
        spotlight=False,
        stream_gen_ai_spans=False,
        enable_logs=False,
        enable_metrics=False,
        profiles_sample_rate=0.0,
        profile_session_sample_rate=0.0,
        enable_db_query_source=False,
        enable_http_request_source=False,
    )
    sentry_sdk.set_tag("surface", "cloud_api")
    sentry_sdk.set_tag("telemetry_mode", "hosted_product")


def set_server_sentry_user(user_id: str) -> None:
    if not _sentry_initialized or sentry_sdk is None:
        return

    validated = canonical_uuid(user_id)
    if validated is None:
        sentry_sdk.set_user(None)
        return
    sentry_sdk.set_user({"id": validated})


def clear_server_sentry_user() -> None:
    """Drop any authenticated user from the current Sentry scope.

    Called at request/session teardown so an authenticated user's identity can
    never leak onto a later, unrelated request handled on the same worker
    (cross-user leakage). Passing ``None`` clears the scope's ``user``.
    """
    if not _sentry_initialized or sentry_sdk is None:
        return

    sentry_sdk.set_user(None)


def _validated_tag(key: Any, value: Any) -> str | None:
    if type(key) is not str:
        return None
    validator = TAG_VALIDATORS.get(key)
    return None if validator is None else validator(value)


def set_server_sentry_tag(key: str, value: str) -> None:
    if not _sentry_initialized or sentry_sdk is None:
        return

    validated = _validated_tag(key, value)
    if validated is None:
        return
    sentry_sdk.set_tag(key, validated)


def set_server_sentry_correlation_context(context: dict[str, str]) -> None:
    if not _sentry_initialized or sentry_sdk is None:
        return
    if type(context) is not dict:
        return

    for key, value in context.items():
        validated = _validated_tag(key, value)
        if validated is not None:
            sentry_sdk.set_tag(key, validated)


def capture_server_sentry_exception(
    error: Any,
    *,
    level: str | None = None,
    tags: dict[str, str] | None = None,
    extras: dict[str, Any] | None = None,
    fingerprint: list[str] | None = None,
) -> None:
    if not _sentry_initialized or sentry_sdk is None:
        return

    normalized = error if isinstance(error, Exception) else Exception("Unknown error")

    with sentry_sdk.push_scope() as scope:
        if level is not None and level in EVENT_LEVELS:
            scope.level = level

        if type(tags) is dict:
            for key, value in tags.items():
                validated = _validated_tag(key, value)
                if validated is not None:
                    scope.set_tag(key, validated)

        if type(extras) is dict:
            for key, value in extras.items():
                if type(key) is not str or key not in EXTRA_VALIDATORS:
                    continue
                scope.set_extra(key, project_extra_value(key, value))

        sentry_sdk.capture_exception(normalized)


def report_critical(
    error: Any,
    *,
    tags: dict[str, str] | None = None,
    extras: dict[str, Any] | None = None,
    **context: Any,
) -> None:
    """Report a page-worthy failure to Sentry (level=fatal) and structured logs.

    Contract fields (stable for Grafana/Sentry alert rules):
    - Sentry tag: critical_failure=true, level=fatal
    - Log extra: critical_failure=True
    - Log message contains "CRITICAL_FAILURE" marker for CloudWatch filtering
    """
    merged_tags: dict[str, Any] = {}
    if type(tags) is dict:
        for key, value in tags.items():
            if _validated_tag(key, value) is not None:
                merged_tags[key] = value
    merged_tags["critical_failure"] = "true"

    capture_server_sentry_exception(
        error,
        level="fatal",
        tags=merged_tags,
        extras=extras,
    )

    log_extra: dict[str, Any] = {"critical_failure": True}
    if context:
        log_extra.update(context)
    if extras:
        log_extra.update(extras)

    _report_critical_logger.exception(
        "CRITICAL_FAILURE: %s",
        str(error),
        extra=log_extra,
    )


def flush_server_sentry(timeout: float = 2.0) -> None:
    if not _sentry_initialized or sentry_sdk is None:
        return

    sentry_sdk.flush(timeout=timeout)
