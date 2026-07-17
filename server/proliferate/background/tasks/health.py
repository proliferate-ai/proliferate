"""Health tasks for the background job substrate."""

from __future__ import annotations

import json
import logging

from celery import Task

from proliferate.background.celery_app import celery_app
from proliferate.background.config import HEALTH_NOOP_TASK

logger = logging.getLogger(__name__)


def _build_receipt_logger() -> logging.Logger:
    """Message-only logger so the receipt is a valid standalone log event.

    Mirrors the task-metrics logger: Celery's default formatter would prefix
    each record with ``[timestamp: level/process]``, which breaks a CloudWatch
    Logs filter/Insights match on the bare JSON object. A dedicated
    non-propagating handler emits the receipt line unadorned.
    """

    receipt_logger = logging.getLogger("proliferate.background.health_receipt")
    if not receipt_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        receipt_logger.addHandler(handler)
        receipt_logger.setLevel(logging.INFO)
        receipt_logger.propagate = False
    return receipt_logger


_receipt_logger = _build_receipt_logger()


def build_health_receipt(task_id: str) -> dict[str, object]:
    """Return the safe exact-ID execution receipt for a health no-op run.

    Carries only the Celery task id (which the relay sets equal to the outbox
    row id — a UUID, not a secret) and a stable status marker. This lets the
    deploy proof correlate a fresh success to the EXACT row it enqueued rather
    than to any concurrent health no-op that happened to satisfy an aggregate
    metric. Pure so it can be asserted directly.
    """

    return {"background_health_receipt": {"task_id": task_id[:128], "status": "ok"}}


@celery_app.task(name=HEALTH_NOOP_TASK, bind=True)
def noop(self: Task) -> str:
    # Bound so the task can read its own id (== the relay's outbox id) and log an
    # exact-ID execution receipt on success. The deploy gate matches this line's
    # task_id against the outbox id it enqueued, so an unrelated concurrent health
    # no-op cannot satisfy the proof.
    _receipt_logger.info(json.dumps(build_health_receipt(str(self.request.id))))
    return "ok"
