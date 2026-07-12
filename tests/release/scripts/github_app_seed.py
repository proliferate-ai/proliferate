"""T3 GitHub App authorization seeding + real post-callback trigger.

Ruled intent (Pablo, 2026-07-09): do NOT bypass the GitHub App authorization
gate — it is load-bearing (it mints the installation tokens used for cloning +
the git credential helper in sandboxes, and it is the trigger that kicks off
E2B sandbox creation). Instead, make the interactive browser dance *seedable*:
plant its OUTCOME — a real user-to-server authorization + the real installation
cache row — for a test user, so everything downstream runs real product code
against real GitHub.

This is the sanctioned deliverable-A seam: a runner-side script that writes the
exact rows `complete_github_app_user_authorization_callback`
(server/proliferate/server/cloud/github_app/service.py:274) would produce, via
the server's OWN service/store functions in-process — NO product change. The
only thing it does not do is exchange a browser-delivered OAuth `code`; that
outcome (a real user-to-server token) is instead obtained by *refreshing* a real
GitHub App refresh token the operator has provided once — the same
`refresh_github_app_user_authorization` call the product itself uses. Never a
faked GitHub, never a synthetic token.

What the callback writes, and what this reproduces:
  1. `github_app_store.upsert_github_app_authorization` — the
     `github_app_authorizations` row (encrypted user-to-server access + refresh
     tokens, status=ready, github_login/github_user_id). ← `seed`
  2. `ensure_personal_cloud_sandbox_exists` + `schedule_materialize_sandbox` —
     the sandbox-provisioning trigger. ← `trigger`
  3. `refresh_github_app_installation_cache` — the `github_app_installations`
     rows, listed via the App JWT (App private key). ← `seed` and `trigger`

Token lifecycle: GitHub App user-to-server refresh tokens ROTATE on every
refresh. The single live refresh token is kept in a small JSON state file
(`RELEASE_E2E_GITHUB_APP_SEED_STATE`, default
~/.proliferate-local/dev/release-e2e-github-seed.json). Each refresh rewrites
that file atomically. First-run bootstrap reads
`RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN` when the state file is absent.
Because every seeded row shares one underlying GitHub identity (whichever
account authorized the configured App), and refresh tokens rotate, only the
most-recently-seeded row keeps a still-valid refresh token — fine for the short
lifetimes of tier-3 fixture users (access tokens are valid ~8h; fresh users are
torn down at end of run; the durable user is re-seeded before each run).

Usage:
  uv run python github_app_seed.py seed <email>
  uv run python github_app_seed.py trigger <email> [--poll-timeout-seconds N]
  uv run python github_app_seed.py status <email>
  uv run python github_app_seed.py teardown <email>

Prints one JSON object to stdout. `seed`/`trigger` additionally exercise a real
server code path that proves the seed yields working credentials:
`list_github_app_accessible_repositories` (real repo listing via the seeded
user token) and a real installation-token mint via the App JWT.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import select  # noqa: E402

from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.auth import User  # noqa: E402
from proliferate.db.store import cloud_sandboxes as sandbox_store  # noqa: E402
from proliferate.db.store import github_app as github_app_store  # noqa: E402
from proliferate.db.store.billing_subjects import (  # noqa: E402
    ensure_free_included_grant,
    ensure_personal_billing_subject,
)
from proliferate.integrations.github.app_installations import (  # noqa: E402
    create_github_app_jwt,
    list_github_app_installations,
)
from proliferate.integrations.github.app_user_tokens import (  # noqa: E402
    GitHubAppUserAuthorization,
    refresh_github_app_user_authorization,
)
from proliferate.server.cloud.cloud_sandboxes.service import (  # noqa: E402
    destroy_cloud_sandbox,
    ensure_personal_cloud_sandbox_exists,
)
from proliferate.server.cloud.github_app.repo_authority import (  # noqa: E402
    ensure_fresh_github_app_authorization,
)
from proliferate.server.cloud.github_app.service import (  # noqa: E402
    list_github_app_accessible_repositories,
    refresh_github_app_installation_cache,
)
from proliferate.server.cloud.materialization.materialize.sandbox import (  # noqa: E402
    materialize_sandbox,
)
from proliferate.utils.crypto import decrypt_text  # noqa: E402
from proliferate.utils.time import utcnow  # noqa: E402

_DEFAULT_STATE_PATH = (
    Path.home() / ".proliferate-local" / "dev" / "release-e2e-github-seed.json"
)


def _state_path() -> Path:
    override = os.environ.get("RELEASE_E2E_GITHUB_APP_SEED_STATE", "").strip()
    return Path(override) if override else _DEFAULT_STATE_PATH


def _load_seed_refresh_token() -> str:
    """The current live refresh token: state file first, env bootstrap second."""
    path = _state_path()
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        token = data.get("refresh_token")
        if isinstance(token, str) and token.strip():
            return token.strip()
    env_token = os.environ.get("RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN", "").strip()
    if env_token:
        return env_token
    raise RuntimeError(
        "No GitHub App seed refresh token available: neither the state file "
        f"({path}) nor RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN is set. Bootstrap "
        "one from a real (browser-completed) App authorization for the configured "
        "App, then this script self-rotates it."
    )


def _persist_seed_state(authorization: GitHubAppUserAuthorization) -> None:
    """Atomically record the rotated refresh token (state file is source of truth)."""
    if not authorization.refresh_token:
        return
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "refresh_token": authorization.refresh_token,
        "github_login": authorization.github_login,
        "github_user_id": authorization.github_user_id,
        "rotated_at": utcnow().isoformat(),
    }
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".seed-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


async def _resolve_user(db, email: str) -> User | None:
    return (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()


async def _ensure_seeded_compute_grant(db, user: User) -> None:
    """Test SETUP: give the fixture user usable compute credits so enforce-mode
    billing doesn't block materialization before E2B is reached.

    Under pro billing, only `free_trial_v2`/refill grant types are eligible for
    a free (non-subscribed) user (`grant_applies_to_paid_state`); the product
    issues that grant only for GitHub-linked identities (ruled working-as-
    intended 2026-07-08). This writes the identical grant row via the product's
    own model, keyed by the same source_ref convention so it is idempotent.
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from proliferate.config import settings as server_settings
    from proliferate.constants.billing import (
        FREE_TRIAL_V2_GRANT_TYPE,
        PRO_FREE_TRIAL_HOURS,
    )
    from proliferate.db.models.billing import BillingGrant

    if not server_settings.pro_billing_enabled:
        await ensure_free_included_grant(db, user_id=user.id)
        return
    subject = await ensure_personal_billing_subject(db, user.id)
    now = utcnow()
    await db.execute(
        pg_insert(BillingGrant)
        .values(
            user_id=user.id,
            billing_subject_id=subject.id,
            grant_type=FREE_TRIAL_V2_GRANT_TYPE,
            hours_granted=PRO_FREE_TRIAL_HOURS,
            remaining_seconds=PRO_FREE_TRIAL_HOURS * 3600.0,
            effective_at=now,
            expires_at=None,
            source_ref=f"{FREE_TRIAL_V2_GRANT_TYPE}:{subject.id}",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingGrant.source_ref])
    )
    await db.flush()


async def _obtain_real_authorization(db, user: User) -> GitHubAppUserAuthorization | None:
    """Reuse the user's current authorization if still fresh; else refresh the
    seed token (rotating it). Returns None only if we chose to reuse the existing
    row (nothing new to upsert)."""
    existing = await github_app_store.get_github_app_authorization_for_user(
        db, user_id=user.id
    )
    if existing is not None and existing.status == "ready" and existing.access_token:
        # Current for well over the test's lifetime → reuse; no rotation churn.
        if existing.token_expires_at is not None and existing.token_expires_at > utcnow():
            return None
    refresh_token = _load_seed_refresh_token()
    authorization = await refresh_github_app_user_authorization(refresh_token=refresh_token)
    _persist_seed_state(authorization)
    return authorization


async def _seed_authorization(db, user: User) -> dict:
    authorization = await _obtain_real_authorization(db, user)
    if authorization is not None:
        await github_app_store.upsert_github_app_authorization(
            db, user_id=user.id, authorization=authorization
        )
        await db.commit()
    # Populate the installation cache exactly as the callback does (App JWT).
    await refresh_github_app_installation_cache(db)
    await db.commit()
    stored = await github_app_store.get_github_app_authorization_for_user(db, user_id=user.id)
    return {
        "github_login": stored.github_login if stored else None,
        "github_user_id": stored.github_user_id if stored else None,
        "status": stored.status if stored else None,
        "token_expires_at": str(stored.token_expires_at) if stored and stored.token_expires_at else None,
    }


async def _verify_credentials(db, user: User) -> dict:
    """Exercise real server code paths to prove the seed yields working creds:
    a real repo listing via the seeded user token, and a real installation-token
    mint via the App JWT."""
    out: dict = {}
    try:
        page = await list_github_app_accessible_repositories(db, user=user, limit=5)
        repos = getattr(page, "repositories", None) or getattr(page, "items", None) or []
        out["accessible_repo_count"] = len(repos)
        out["accessible_repo_sample"] = [
            getattr(r, "full_name", getattr(r, "name", str(r))) for r in repos[:5]
        ]
        out["user_token_repo_listing_ok"] = True
    except Exception as exc:  # noqa: BLE001 — surfaced in JSON, not swallowed
        out["user_token_repo_listing_ok"] = False
        out["user_token_repo_listing_error"] = f"{type(exc).__name__}: {exc}"
    try:
        import httpx

        installations = await list_github_app_installations()
        out["installations"] = [
            {
                "id": i.github_installation_id,
                "login": i.account_login,
                "selection": i.repository_selection,
            }
            for i in installations
        ]
        if installations:
            iid = installations[0].github_installation_id
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    f"https://api.github.com/app/installations/{iid}/access_tokens",
                    headers={
                        "Authorization": f"Bearer {create_github_app_jwt()}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
            out["installation_token_mint_status"] = response.status_code
            out["installation_token_minted"] = response.status_code < 300
    except Exception as exc:  # noqa: BLE001
        out["installation_token_minted"] = False
        out["installation_token_error"] = f"{type(exc).__name__}: {exc}"
    return out


async def cmd_seed(email: str) -> dict:
    async with async_session_factory() as db:
        user = await _resolve_user(db, email)
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        seeded = await _seed_authorization(db, user)
        verified = await _verify_credentials(db, user)
        return {"seeded": seeded, "verify": verified, "error": None}


async def cmd_status(email: str) -> dict:
    """Report whether the user has a ready App authorization — for the negative
    trigger-contract assertion (a fresh, unseeded user must have none)."""
    async with async_session_factory() as db:
        user = await _resolve_user(db, email)
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        try:
            await ensure_fresh_github_app_authorization(db, user_id=user.id)
            authorized = True
            gate_error = None
        except Exception as exc:  # noqa: BLE001 — CloudApiError is the expected "not authorized"
            authorized = False
            gate_error = f"{type(exc).__name__}: {getattr(exc, 'code', '')}".strip()
        sandbox = await sandbox_store.load_personal_cloud_sandbox(db, user.id)
        return {
            "authorized": authorized,
            "gate_error": gate_error,
            "has_personal_sandbox": sandbox is not None,
            "sandbox_status": sandbox.status if sandbox else None,
            "error": None,
        }


async def cmd_trigger(email: str, poll_timeout_seconds: int) -> dict:
    """The real post-callback completion flow, minus only the browser redirect:
    seed the authorization, then run the exact service chain the callback runs —
    ensure_personal_cloud_sandbox_exists + materialize (schedule_materialize's
    real work) + refresh_github_app_installation_cache — and prove a real E2B
    sandbox materializes for the seeded user.
    """
    started_at = time.monotonic()
    async with async_session_factory() as db:
        user = await _resolve_user(db, email)
        if user is None:
            return {"error": f"no user found for email {email!r}"}

        # Trigger contract: no sandbox before the callback fires.
        pre_existing = await sandbox_store.load_personal_cloud_sandbox(db, user.id)

        seeded = await _seed_authorization(db, user)
        verified = await _verify_credentials(db, user)

        # Billing SETUP (not part of the trigger contract): under pro-billing
        # enforce (PRO_BILLING_ENABLED=true + CLOUD_BILLING_MODE=enforce, live on
        # t3local since the 2026-07-08 billing arc), the free-trial grant requires
        # a linked GitHub *identity* (`ensure_free_trial_v2_grant` →
        # `_linked_github_provider_user_id`), which password-only fixture users
        # never have — ruled working-as-intended 2026-07-08 ("GitHub identity IS
        # the bad-actor gate for free credits"). Without credits, enforcement
        # blocks materialization with credits_exhausted before E2B is reached.
        # This provisioning-only fixture setup is not billing qualification;
        # authoritative billing scenarios use correlation-owned subjects and
        # must never mutate this shared durable grant. Under pro billing only
        # `free_trial_v2` (or refill)
        # grant types count for a free user (`grant_applies_to_paid_state`,
        # plans.py:316), so seed the trial-v2 shape directly — the same row
        # `ensure_free_trial_v2_grant` writes, minus its GitHub-identity gate
        # (this seam exists precisely because fixture users are password-only).
        await _ensure_seeded_compute_grant(db, user)
        await db.commit()

        # ↓↓↓ exact body of complete_github_app_user_authorization_callback ↓↓↓
        sandbox = await ensure_personal_cloud_sandbox_exists(db, user_id=user.id)
        await db.commit()
        sandbox_kicked_off = sandbox is not None

        materialize_error: str | None = None
        try:
            # `schedule_materialize_sandbox` defers to run_after_commit; with no
            # ambient request transaction we invoke the materializer directly —
            # the actual provisioning work (see prov1_fallback.py for the wall-
            # clock reasoning).
            await materialize_sandbox(db, user_id=user.id)
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            materialize_error = f"{type(exc).__name__}: {exc}"

    ready_sandbox = None
    async with async_session_factory() as poll_db:
        while time.monotonic() - started_at < poll_timeout_seconds:
            current = await sandbox_store.load_personal_cloud_sandbox(poll_db, user.id)
            if current is not None and current.status == "ready" and current.anyharness_base_url:
                ready_sandbox = current
                break
            await asyncio.sleep(3)
            await poll_db.rollback()

    result: dict = {
        "seeded": seeded,
        "verify": verified,
        "preExistingSandbox": pre_existing is not None,
        "sandboxKickedOffByTrigger": sandbox_kicked_off,
    }
    if ready_sandbox is None:
        async with async_session_factory() as final_db:
            current = await sandbox_store.load_personal_cloud_sandbox(final_db, user.id)
        result.update(
            {
                "sandboxId": str(current.id) if current else None,
                "status": current.status if current else None,
                "anyharnessBaseUrl": None,
                "readyWithinSeconds": None,
                "agentsProbe": None,
                "error": materialize_error
                or f"sandbox did not reach status=ready within {poll_timeout_seconds}s",
            }
        )
        return result

    elapsed = round(time.monotonic() - started_at, 1)
    agents_probe = None
    probe_error: str | None = None
    try:
        import httpx

        bearer = decrypt_text(ready_sandbox.anyharness_bearer_token_ciphertext)
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{ready_sandbox.anyharness_base_url}/v1/agents",
                headers={"authorization": f"Bearer {bearer}"},
            )
            response.raise_for_status()
            agents_probe = response.json()
    except Exception as exc:  # noqa: BLE001
        probe_error = f"{type(exc).__name__}: {exc}"

    result.update(
        {
            "sandboxId": str(ready_sandbox.id),
            "status": ready_sandbox.status,
            "anyharnessBaseUrl": ready_sandbox.anyharness_base_url,
            "readyWithinSeconds": elapsed,
            "agentsProbe": agents_probe,
            "error": materialize_error or probe_error,
        }
    )
    return result


async def cmd_teardown(email: str) -> dict:
    async with async_session_factory() as db:
        user = await _resolve_user(db, email)
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        destroyed = await destroy_cloud_sandbox(db, user)
        await db.commit()
        return {
            "destroyed": destroyed is not None,
            "sandboxId": str(destroyed.id) if destroyed else None,
        }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["seed", "trigger", "status", "teardown"])
    parser.add_argument("email")
    parser.add_argument("--poll-timeout-seconds", type=int, default=300)
    return parser


if __name__ == "__main__":
    args = _build_parser().parse_args()
    if args.command == "seed":
        out = asyncio.run(cmd_seed(args.email))
    elif args.command == "trigger":
        out = asyncio.run(cmd_trigger(args.email, args.poll_timeout_seconds))
    elif args.command == "status":
        out = asyncio.run(cmd_status(args.email))
    else:
        out = asyncio.run(cmd_teardown(args.email))
    print(json.dumps(out))
