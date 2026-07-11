"""Workflow schedule/poll beat for the T3-WF live lanes.

`make run PROFILE=<name>` does NOT start any automation/workflow worker (the
`dev-automation-worker` make target is parked), and the full worker entrypoint
(`proliferate.server.automations.worker.main`) currently fails to import — its
single-prompt automation path pulls a deleted module (`proliferate.db.models.
cloud.repo_config`). The workflow schedule-trigger scheduler + poll poller are
independent of that path, so this runs JUST those two loops (spec 3.5 / 4.2) so a
live scenario (T3-WF-7 desktop lane; the firing half of T3-WF-6) has a beat to
fire due triggers.

Reads DATABASE_URL (the profile DB) and API_BASE_URL / CLOUD_WORKER_BASE_URL
(the run's per-run gateway grant needs a reachable cloud base URL at fire time —
without it the fire raises `cloud_worker_misconfigured` and no run is created).

Usage (via the server venv so deps resolve):
  DATABASE_URL=... API_BASE_URL=http://127.0.0.1:<api> \
    server/.venv/bin/python tests/release/scripts/workflow_scheduler_beat.py [--interval-seconds N]
"""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from proliferate.server.cloud.workflows.poller import run_workflow_poller_loop  # noqa: E402
from proliferate.server.cloud.workflows.scheduler import (  # noqa: E402
    run_workflow_scheduler_loop,
)
from proliferate.utils.logging import configure_server_logging  # noqa: E402


async def _amain(interval_seconds: float) -> None:
    configure_server_logging()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    print(
        f"[wf-beat] workflow scheduler + poller loops (interval {interval_seconds}s)",
        flush=True,
    )
    await asyncio.gather(
        run_workflow_scheduler_loop(
            interval_seconds=interval_seconds, batch_size=100, stop_event=stop
        ),
        run_workflow_poller_loop(
            interval_seconds=interval_seconds, batch_size=100, stop_event=stop
        ),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval-seconds", type=float, default=5.0)
    args = parser.parse_args()
    asyncio.run(_amain(args.interval_seconds))
