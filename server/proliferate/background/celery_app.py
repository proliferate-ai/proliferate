"""Celery app for Proliferate background jobs."""

from __future__ import annotations

from celery import Celery

from proliferate.background.beat_schedule import build_beat_schedule
from proliferate.background.config import build_celery_config

celery_app = Celery("proliferate")
celery_app.conf.update(build_celery_config())
celery_app.conf.beat_schedule = build_beat_schedule()

# Import task modules after app construction so decorators register on celery_app.
import proliferate.background.tasks.health  # noqa: E402,F401
