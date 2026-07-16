"""Periodic reap of orphaned provider (E2B) sandboxes.

Thin Beat-fired wrapper over the domain-owned pass in
``proliferate.server.cloud.cloud_sandboxes.reaper``. The pass opens its own
sessions and holds a Postgres advisory lock for cross-worker singleton
behavior, so this wrapper stays thin.
"""

from __future__ import annotations

import asyncio

from proliferate.background.celery_app import celery_app
from proliferate.background.config import CLOUD_SANDBOX_ORPHAN_REAP_TASK
from proliferate.server.cloud.cloud_sandboxes.reaper import run_orphan_sandbox_reap_pass


@celery_app.task(name=CLOUD_SANDBOX_ORPHAN_REAP_TASK)
def cloud_sandbox_orphan_reap() -> str:
    asyncio.run(run_orphan_sandbox_reap_pass())
    return "ok"
