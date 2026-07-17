"""Worker-side task outcome telemetry.

Celery signal handlers project one low-cardinality JSON line per task success,
retry, or failure so the hosted CloudWatch metric filters can build
success/retry/failure counts dimensioned by task name and a safe error code.

Only the task name (already a fixed, low-cardinality value from our registry)
and the exception class name (stable, secret-free) are emitted. Task arguments,
keyword arguments, return values, broker URLs, credentials, and raw traceback
strings are never logged here.
"""

from __future__ import annotations

import json
import logging
import time

from celery.signals import task_failure, task_prerun, task_retry, task_success

from proliferate.background.config import BACKGROUND_PUBLISH_TS_HEADER

logger = logging.getLogger(__name__)


def _build_metrics_logger() -> logging.Logger:
    """Message-only logger so the JSON line is a valid standalone metric event.

    Mirrors the relay metrics logger: Celery's default formatter would prefix
    each record with ``[timestamp: level/process]``, which breaks the CloudWatch
    JSON metric-filter patterns. A dedicated non-propagating handler emits the
    bare JSON object instead.
    """

    metrics_logger = logging.getLogger("proliferate.background.task_metrics")
    if not metrics_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        metrics_logger.addHandler(handler)
        metrics_logger.setLevel(logging.INFO)
        metrics_logger.propagate = False
    return metrics_logger


_metrics_logger = _build_metrics_logger()


def _safe_task_name(sender: object) -> str:
    name = getattr(sender, "name", None)
    if isinstance(name, str) and name:
        # Bounded defensively; task names in our registry are short and fixed.
        return name[:128]
    return "unknown"


def _safe_error_code(exception: BaseException | None) -> str:
    if exception is None:
        return "none"
    # The class name is stable and secret-free; the raw message may carry a
    # broker URL, credentials, or payload, so it is never emitted.
    return type(exception).__name__[:128]


def build_task_metric(
    outcome: str,
    *,
    task_name: str,
    error_code: str = "none",
) -> dict[str, object]:
    """Return the safe, low-cardinality metric payload for one task outcome.

    Pure and side-effect-free so it can be asserted directly. Only the outcome,
    the (fixed-registry) task name, and the safe error code are included.
    """

    return {
        "background_task": {
            "outcome": outcome,
            "task_name": task_name,
            "error_code": error_code,
            "count": 1,
        }
    }


def parse_publish_timestamp(raw: object) -> float | None:
    """Return the stamped broker-publish epoch seconds, or ``None`` if absent.

    The relay stamps ``BACKGROUND_PUBLISH_TS_HEADER`` with ``repr(time.time())``.
    Anything unparseable or non-finite is ignored so a malformed header can never
    emit a bogus age or raise inside the worker signal path.
    """

    if raw is None:
        return None
    try:
        value = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if value != value or value in (float("inf"), float("-inf")):  # NaN/inf guard
        return None
    return value


def build_queue_age_metric(task_name: str, age_seconds: float) -> dict[str, object]:
    """Return the safe broker-residence-latency payload for one consumed task.

    ``age_seconds`` is the time the task spent in the broker between relay
    publish and worker consume. This is a LAGGING per-task latency observed on
    consume, NOT a current "oldest queued task age": it is emitted only when a
    task is actually consumed, so it goes silent when consumption stalls. Amazon
    MQ exposes no native oldest-message-age metric; current backlog is covered by
    the broker MessageCount depth alarm instead. Dimensioned only by the
    fixed-registry task name; the value is a duration, never a secret. Pure so it
    can be asserted directly.
    """

    return {
        "background_queue_age": {
            "task_name": task_name,
            "age_seconds": round(max(0.0, age_seconds), 3),
        }
    }


def _emit(outcome: str, *, task_name: str, error_code: str = "none") -> None:
    payload = build_task_metric(outcome, task_name=task_name, error_code=error_code)
    _metrics_logger.info(json.dumps(payload))


def _publish_ts_from_request(task: object) -> object:
    request = getattr(task, "request", None)
    if request is None:
        return None
    getter = getattr(request, "get", None)
    if callable(getter):
        return getter(BACKGROUND_PUBLISH_TS_HEADER)
    return getattr(request, BACKGROUND_PUBLISH_TS_HEADER, None)


@task_prerun.connect
def _on_task_prerun(task: object = None, **_: object) -> None:
    # Emit the broker-residence latency: the wall-clock gap between when the
    # relay published the message and when the worker began executing it. This is
    # a LAGGING per-task latency observed on consume, not a current oldest-age
    # gauge — it is only emitted for tasks that actually got consumed and goes
    # silent when consumption stalls. Missing/malformed header (e.g. tasks
    # published without the relay stamp) simply emits nothing.
    published_at = parse_publish_timestamp(_publish_ts_from_request(task))
    if published_at is None:
        return
    age_seconds = time.time() - published_at
    _metrics_logger.info(json.dumps(build_queue_age_metric(_safe_task_name(task), age_seconds)))


@task_success.connect
def _on_task_success(sender: object = None, **_: object) -> None:
    _emit("success", task_name=_safe_task_name(sender))


@task_retry.connect
def _on_task_retry(sender: object = None, reason: object = None, **_: object) -> None:
    error_code = _safe_error_code(reason if isinstance(reason, BaseException) else None)
    _emit("retry", task_name=_safe_task_name(sender), error_code=error_code)


@task_failure.connect
def _on_task_failure(
    sender: object = None,
    exception: BaseException | None = None,
    **_: object,
) -> None:
    _emit("failure", task_name=_safe_task_name(sender), error_code=_safe_error_code(exception))
