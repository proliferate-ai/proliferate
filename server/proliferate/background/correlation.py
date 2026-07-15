"""Correlation context binding for Celery background tasks.

Provides a Celery base task class that extracts correlation IDs from task
headers and binds them into the request-context context vars, so log lines
and Sentry events emitted by background tasks carry the same correlation
fields as API requests.

Usage:
    @celery_app.task(base=CorrelatedTask, name="...")
    def my_task(payload, **kwargs):
        ...

Producers should pass correlation fields via task headers:
    task.apply_async(args=[...], headers=capture_correlation_context())
"""

from __future__ import annotations

from celery import Task

from proliferate.middleware.request_context import (
    _CORRELATION_VARS,
    with_correlation_context,
)

_HEADER_KEYS = frozenset(_CORRELATION_VARS.keys())


class CorrelatedTask(Task):
    """Celery base task that binds correlation context from task headers."""

    abstract = True

    def __call__(self, *args: object, **kwargs: object) -> object:
        headers = getattr(self.request, "headers", None) or {}
        context_fields = {
            key: value for key, value in headers.items() if key in _HEADER_KEYS and value
        }
        with with_correlation_context(**context_fields):
            return super().__call__(*args, **kwargs)
