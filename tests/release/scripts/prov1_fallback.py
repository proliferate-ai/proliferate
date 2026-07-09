"""T3-PROV-1 fallback seam (specs/developing/testing/scenarios.md#T3-PROV-1).

The scenario contract: the cold-provisioning path under test is the GitHub
App authorization callback (`complete_github_app_user_authorization_callback`,
server/proliferate/server/cloud/github_app/service.py:274) calling
`ensure_personal_cloud_sandbox_exists` + `schedule_materialize_sandbox`. That
callback needs a real GitHub OAuth `code`, and this repo's dev GitHub App's
callback URL is pinned to the `main` profile's port
(specs/developing/local/feature-worktree-auth.md, Layer C) — a dedicated
`t3local` profile cannot receive it. Real attempt made and documented in the
final report; this script is the contract's sanctioned fallback: "invoke the
exact post-authorization service call the callback makes — never a faked
GitHub."

Run in-process (not over HTTP) on purpose: this bypasses `current_product_user`
too, since that dependency is enforced by FastAPI's route wiring, not inside
the service functions themselves — the same reason it is a legitimate stand-in
for the callback and not a workaround for the (separately tracked)
`github_link_required` gate.

Usage: uv run python prov1_fallback.py <user-email> [--poll-timeout-seconds N]
Prints one JSON object to stdout: {"sandboxId", "status", "anyharnessBaseUrl",
"readyWithinSeconds", "agentsProbe": {...} | null, "error": str | null}.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import select  # noqa: E402

from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.auth import User  # noqa: E402
from proliferate.db.store import cloud_sandboxes as sandbox_store  # noqa: E402
from proliferate.server.cloud.cloud_sandboxes.service import (  # noqa: E402
    destroy_cloud_sandbox,
    ensure_personal_cloud_sandbox_exists,
)
from proliferate.server.cloud.materialization.materialize.sandbox import (  # noqa: E402
    materialize_sandbox,
)
from proliferate.utils.crypto import decrypt_text  # noqa: E402


async def main(email: str, poll_timeout_seconds: int) -> dict:
    # Started before `ensure_personal_cloud_sandbox_exists`/`materialize_sandbox`
    # run, not after — the real E2B provisioning wall time is spent *inside*
    # the awaited `materialize_sandbox` call itself, not in the polling loop
    # below (which is why an earlier version of this script that started the
    # clock after materialize_sandbox always read back ~0s: it was only timing
    # a poll of an already-ready row).
    started_at = time.monotonic()
    sessionmaker = async_session_factory
    async with sessionmaker() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            return {"error": f"no user found for email {email!r}"}

        sandbox = await ensure_personal_cloud_sandbox_exists(db, user_id=user.id)
        await db.commit()

        # `schedule_materialize_sandbox` normally defers this until after the
        # request's transaction commits (`runner.run_after_commit`); this
        # script has no ambient request transaction, so it calls the
        # materializer directly, which is the actual provisioning work.
        materialize_error: str | None = None
        try:
            await materialize_sandbox(db, user_id=user.id)
            await db.commit()
        except Exception as exc:  # noqa: BLE001 - surfaced in the JSON result, not swallowed
            materialize_error = f"{type(exc).__name__}: {exc}"

    ready_sandbox = None
    async with sessionmaker() as poll_db:
        while time.monotonic() - started_at < poll_timeout_seconds:
            current = await sandbox_store.load_personal_cloud_sandbox(poll_db, user.id)
            if current is not None and current.status == "ready" and current.anyharness_base_url:
                ready_sandbox = current
                break
            await asyncio.sleep(3)
            await poll_db.rollback()  # drop the read snapshot so the next iteration sees fresh commits

    if ready_sandbox is None:
        async with sessionmaker() as final_db:
            current = await sandbox_store.load_personal_cloud_sandbox(final_db, user.id)
        return {
            "sandboxId": str(current.id) if current else None,
            "status": current.status if current else None,
            "anyharnessBaseUrl": None,
            "readyWithinSeconds": None,
            "agentsProbe": None,
            "error": materialize_error or f"sandbox did not reach status=ready within {poll_timeout_seconds}s",
        }

    elapsed = round(time.monotonic() - started_at, 1)
    agents_probe: dict | list | str | None = None
    probe_error: str | None = None
    try:
        import httpx

        bearer_token = decrypt_text(ready_sandbox.anyharness_bearer_token_ciphertext)
        async with httpx.AsyncClient(timeout=15) as http_client:
            response = await http_client.get(
                f"{ready_sandbox.anyharness_base_url}/v1/agents",
                headers={"authorization": f"Bearer {bearer_token}"},
            )
            response.raise_for_status()
            agents_probe = response.json()
    except Exception as exc:  # noqa: BLE001
        probe_error = f"{type(exc).__name__}: {exc}"

    return {
        "sandboxId": str(ready_sandbox.id),
        "status": ready_sandbox.status,
        "anyharnessBaseUrl": ready_sandbox.anyharness_base_url,
        "readyWithinSeconds": elapsed,
        "agentsProbe": agents_probe,
        "error": materialize_error or probe_error,
    }


async def teardown(email: str) -> dict:
    """Best-effort teardown for the fresh-user flow: destroys the personal
    cloud sandbox (retires its worker/gateway token) via the same in-process
    service-call seam. Real product code path
    (`server/proliferate/server/cloud/cloud_sandboxes/service.py:66`
    `destroy_cloud_sandbox`), just invoked directly rather than through the
    current_product_user-gated `DELETE /cloud-sandbox` route.
    """
    async with async_session_factory() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        destroyed = await destroy_cloud_sandbox(db, user)
        await db.commit()
        return {"destroyed": destroyed is not None, "sandboxId": str(destroyed.id) if destroyed else None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("email")
    parser.add_argument("--poll-timeout-seconds", type=int, default=300)
    parser.add_argument("--teardown", action="store_true", help="destroy the personal sandbox instead of creating one")
    args = parser.parse_args()
    if args.teardown:
        result = asyncio.run(teardown(args.email))
    else:
        result = asyncio.run(main(args.email, args.poll_timeout_seconds))
    print(json.dumps(result))
