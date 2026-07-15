"""Celery app for Proliferate background jobs."""

from __future__ import annotations

from celery import Celery

from proliferate.background.beat_schedule import build_beat_schedule
from proliferate.background.config import build_celery_config

celery_app = Celery("proliferate")
celery_app.conf.update(build_celery_config())
celery_app.conf.beat_schedule = build_beat_schedule()

# Imported after app construction so decorators/signal handlers register on
# celery_app: the tasks.* modules register their @celery_app.task wrappers, and
# task_metrics connects the worker-side success/retry/failure signal handlers.
# All imported for side effects; no symbol is used directly here.
import proliferate.background.task_metrics  # noqa: E402,F401
import proliferate.background.tasks.customerio_sync  # noqa: E402,F401
import proliferate.background.tasks.health  # noqa: E402,F401
import proliferate.background.tasks.notifications  # noqa: E402,F401
import proliferate.background.tasks.relay  # noqa: E402,F401
