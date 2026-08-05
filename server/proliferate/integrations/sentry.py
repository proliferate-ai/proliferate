from __future__ import annotations

import logging
import re
from collections.abc import Callable
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

_sentry_initialized = False

SENSITIVE_KEY_PATTERN = re.compile(
    r"(authorization|cookie|token|secret|password|api[_-]?key|credential|"
    r"prompt|content|stdout|stderr|request_body|body|env|file_path|path)",
    re.IGNORECASE,
)
ABSOLUTE_PATH_PATTERN = re.compile(r"(?:/Users/[^\s]+|/home/[^\s]+|[A-Za-z]:\\[^\s]+)")
BEARER_TOKEN_PATTERN = re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE)
JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b")


def _scrub_string_patterns(value: str) -> str:
    return (
        BEARER_TOKEN_PATTERN.sub("[redacted-token]", value)
        .replace("\r\n", "\n")
        .replace("\r", "\n")
    )


def scrub_text(value: str) -> str:
    return JWT_PATTERN.sub(
        "[redacted-jwt]",
        ABSOLUTE_PATH_PATTERN.sub("[redacted-path]", _scrub_string_patterns(value)),
    )


def scrub_value(value: Any, key: str | None = None) -> Any:
    if value is None:
        return None

    if key and SENSITIVE_KEY_PATTERN.search(key):
        return "[redacted]"

    if isinstance(value, str):
        return scrub_text(value)

    if isinstance(value, list):
        return [scrub_value(item) for item in value]

    if isinstance(value, tuple):
        return tuple(scrub_value(item) for item in value)

    if isinstance(value, dict):
        return {
            entry_key: scrub_value(entry_value, entry_key)
            for entry_key, entry_value in value.items()
        }

    return value


def scrub_mapping(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return scrub_value(value)


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
    # The top-level `environment` field is deployment identity (e.g. the Sentry
    # environment name), not a raw process-environment map. The generic scrubber
    # would redact it because the key matches `env`, so snapshot it first, run
    # the recursive scrub, then restore the snapshot scrubbed only as text. This
    # is bounded: nested `env`/`environment` keys stay redacted.
    original_environment = event.get("environment")

    scrubbed = scrub_mapping(event) or {}

    if isinstance(original_environment, str):
        scrubbed["environment"] = scrub_text(original_environment)

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


def init_server_sentry(
    *,
    enabled: bool,
    telemetry_mode: str,
    release_resolver: Callable[[], str],
) -> None:
    global _sentry_initialized

    if _sentry_initialized or not enabled or not settings.sentry_dsn or sentry_sdk is None:
        return

    _sentry_initialized = True

    logging_integration = LoggingIntegration(
        level=logging.INFO,
        event_level=None,
    )
    release = release_resolver()

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
    sentry_sdk.set_tag("telemetry_mode", telemetry_mode)


def set_server_sentry_user(user_id: str) -> None:
    if not _sentry_initialized or sentry_sdk is None:
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
    if not _sentry_initialized or sentry_sdk is None:
        return

    sentry_sdk.set_user(None)


def set_server_sentry_tag(key: str, value: str) -> None:
    if not _sentry_initialized or sentry_sdk is None:
        return

    sentry_sdk.set_tag(key, value)


def set_server_sentry_correlation_context(context: dict[str, str]) -> None:
    if not _sentry_initialized or sentry_sdk is None:
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
    if not _sentry_initialized or sentry_sdk is None:
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
    if not _sentry_initialized or sentry_sdk is None:
        return

    sentry_sdk.flush(timeout=timeout)
