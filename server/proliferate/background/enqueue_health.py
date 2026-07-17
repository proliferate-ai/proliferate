"""Enqueue a single committed health no-op outbox row.

Run as a one-off command from the candidate server image during a deploy
(`python -m proliferate.background.enqueue_health --idempotency-key <key>`) to
seed a deterministic, correctness-sensitive outbox row. The deploy workflow then
observes that this row is relayed, published, consumed, and executed by the
candidate worker/Beat plane before the API is rolled — a live end-to-end proof
that the plane can execute newly enqueued work, not just that its ECS resources
report healthy.

This is a thin store client, not a Celery task: it commits one row and exits.
The health no-op handler already exists and is the frozen proof task; no Workflow
behavior is added.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from proliferate.background.config import HEALTH_NOOP_TASK, PERIODIC_DEFAULT_QUEUE
from proliferate.config import settings
from proliferate.db.store.background_outbox import enqueue_outbox_task


async def _enqueue(idempotency_key: str) -> str:
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db, db.begin():
            task = await enqueue_outbox_task(
                db,
                task_name=HEALTH_NOOP_TASK,
                queue=PERIODIC_DEFAULT_QUEUE,
                idempotency_key=idempotency_key,
            )
        return str(task.id)
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--idempotency-key",
        required=True,
        help="Deterministic idempotency key for the proof row (e.g. deploy SHA + run id).",
    )
    args = parser.parse_args()
    outbox_id = asyncio.run(_enqueue(args.idempotency_key))
    # A single stable line the deploy step can log; the row id is not a secret.
    print(f"enqueued_health_noop outbox_id={outbox_id} idempotency_key={args.idempotency_key}")


if __name__ == "__main__":
    main()
