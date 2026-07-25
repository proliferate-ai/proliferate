"""Workflow-owned background task names (PR2 design §8.1).

Packet 1b enqueues these through the transactional outbox; their idempotent
Celery handlers land with the managed-delivery packet. The outbox relay only
claims task names in its supported registry, so items with these names stay
`pending` — with their idempotency keys intact — until the handlers and the
registry entries are added atomically. The names are owned here, next to the
service that enqueues them; the background layer owns only routing values.
"""

from __future__ import annotations

from proliferate.background.config import DEFAULT_QUEUE

WORKFLOWS_OUTBOX_QUEUE = DEFAULT_QUEUE

WORKFLOWS_DELIVER_MANAGED_RUN_TASK = "workflows.deliver_managed_run"
WORKFLOWS_CANCEL_MANAGED_RUN_TASK = "workflows.cancel_managed_run"
WORKFLOWS_ABANDON_MANAGED_RUN_TASK = "workflows.abandon_managed_run"
