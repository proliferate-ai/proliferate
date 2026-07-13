from __future__ import annotations

import logging
from typing import Any

try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
except ImportError:  # pragma: no cover - optional dependency in local/test envs
    sentry_sdk = None
    FastApiIntegration = None
    LoggingIntegration = None
    StarletteIntegration = None

from proliferate.config import settings
from proliferate.server.release import is_canonical_release_id, server_release_id
from proliferate.utils.telemetry_mode import (
    get_server_telemetry_mode,
    is_vendor_telemetry_enabled,
)
from proliferate.utils.telemetry_scrub import scrub_mapping, scrub_text

_sentry_initialized = False


def _scrub_breadcrumb(
    breadcrumb: dict[str, Any],
    _hint: dict[str, Any],
) -> dict[str, Any] | None:
    scrubbed = scrub_mapping(breadcrumb) or {}
    message = scrubbed.get("message")
    if isinstance(message, str):
        scrubbed["message"] = scrub_text(message)
    return scrubbed


def _scrub_event(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any] | None:
    scrubbed = scrub_mapping(event) or {}

    message = scrubbed.get("message")
    if isinstance(message, str):
        scrubbed["message"] = scrub_text(message)

    request = scrubbed.get("request")
    if isinstance(request, dict):
        if request.get("data") is not None:
            request["data"] = "[redacted]"
        if request.get("cookies") is not None:
            request["cookies"] = "[redacted]"
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = scrub_mapping(headers)
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = scrub_text(url)
        scrubbed["request"] = request

    user = scrubbed.get("user")
    if isinstance(user, dict):
        user.pop("ip_address", None)
        scrubbed["user"] = user

    breadcrumbs = scrubbed.get("breadcrumbs")
    if isinstance(breadcrumbs, dict):
        values = breadcrumbs.get("values")
        if isinstance(values, list):
            breadcrumbs["values"] = [
                entry
                for entry in (
                    _scrub_breadcrumb(entry, {}) for entry in values if isinstance(entry, dict)
                )
                if entry is not None
            ]
            scrubbed["breadcrumbs"] = breadcrumbs

    return scrubbed


def init_server_sentry() -> None:
    global _sentry_initialized

    if (
        _sentry_initialized
        or not settings.sentry_dsn
        or sentry_sdk is None
        or not is_vendor_telemetry_enabled()
    ):
        return

    _sentry_initialized = True

    logging_integration = LoggingIntegration(
        level=logging.INFO,
        event_level=None,
    )

    # Prefer a CI-stamped release only when it canonically names this component;
    # otherwise fall back to the code-built `proliferate-server@<version>+<sha>`
    # so a misconfigured `SENTRY_RELEASE` can never stamp the server's Sentry
    # events with another component's (or a malformed) release.
    configured_release = settings.sentry_release
    release = (
        configured_release
        if is_canonical_release_id(configured_release, component="proliferate-server")
        else server_release_id()
    )

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=release,
        attach_stacktrace=True,
        max_breadcrumbs=100,
        send_default_pii=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[
            logging_integration,
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
        before_send=_scrub_event,
        before_breadcrumb=_scrub_breadcrumb,
    )
    sentry_sdk.set_tag("surface", "cloud_api")
    sentry_sdk.set_tag("telemetry_mode", get_server_telemetry_mode())


def set_server_sentry_user(user_id: str) -> None:
    if not settings.sentry_dsn or sentry_sdk is None or not is_vendor_telemetry_enabled():
        return

    sentry_sdk.set_user(
        {
            "id": user_id,
        }
    )


def clear_server_sentry_user() -> None:
    """Drop any authenticated user from the current Sentry scope.

    Called at request/session teardown so an authenticated user's identity can
    never leak onto a later, unrelated request handled on the same worker
    (cross-user leakage). Passing ``None`` clears the scope's ``user``.
    """
    if not settings.sentry_dsn or sentry_sdk is None or not is_vendor_telemetry_enabled():
        return

    sentry_sdk.set_user(None)


def set_server_sentry_tag(key: str, value: str) -> None:
    if not settings.sentry_dsn or sentry_sdk is None or not is_vendor_telemetry_enabled():
        return

    sentry_sdk.set_tag(key, value)


def set_server_sentry_correlation_context(context: dict[str, str]) -> None:
    if not settings.sentry_dsn or sentry_sdk is None or not is_vendor_telemetry_enabled():
        return

    allowed_keys = {
        "request_id",
        "user_id",
        "organization_id",
        "tenant_id",
        "support_report_id",
        "cloud_workspace_id",
        "cloud_target_id",
        "sandbox_profile_id",
        "cloud_sandbox_id",
        "external_sandbox_id",
        "anyharness_workspace_id",
        "session_id",
        "interaction_id",
        "command_id",
        "worker_id",
    }
    for key, value in context.items():
        if key in allowed_keys:
            sentry_sdk.set_tag(key, value)


def capture_server_sentry_exception(
    error: Any,
    *,
    level: str | None = None,
    tags: dict[str, str] | None = None,
    extras: dict[str, Any] | None = None,
    fingerprint: list[str] | None = None,
) -> None:
    if not settings.sentry_dsn or sentry_sdk is None or not is_vendor_telemetry_enabled():
        return

    normalized = (
        error if isinstance(error, Exception) else Exception(str(error or "Unknown error"))
    )

    with sentry_sdk.push_scope() as scope:
        if level is not None:
            scope.level = level

        if fingerprint is not None:
            scope.fingerprint = fingerprint

        if tags:
            for key, value in tags.items():
                scope.set_tag(key, value)

        if extras:
            for key, value in extras.items():
                scrubbed = scrub_mapping({key: value}) or {}
                scope.set_extra(key, scrubbed.get(key))

        sentry_sdk.capture_exception(normalized)


_report_critical_logger = logging.getLogger("proliferate.critical")


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
    merged_tags = dict(tags or {})
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
    if not settings.sentry_dsn or sentry_sdk is None or not is_vendor_telemetry_enabled():
        return

    sentry_sdk.flush(timeout=timeout)
