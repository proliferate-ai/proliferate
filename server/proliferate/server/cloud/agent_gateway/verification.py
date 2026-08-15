"""Control-plane gateway-enablement verification (agent-auth.md FR-3).

One read-only observation per active enrollment key: ask LiteLLM which models
the harness's own virtual key can see, and record a per-key verdict. A key that
sees a non-empty model list is ``ok`` (its access-group grant is live); a key
that sees an empty list is ``misconfigured`` (its access group named by
``harness_kind`` is not granting the models it should). An error observing a key
records NO verdict, so a transient LiteLLM blip never overwrites a
last-known-good.

The verdict feeds the FR-1 evidence model additively: a ``misconfigured`` key
carries a delta the desktop surfaces as ``Misconfigured``. Nothing here logs key
material — only the harness_kind and the key row id, both non-secret.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED,
    AGENT_GATEWAY_VERIFICATION_STATUS_OK,
)
from proliferate.db.store.agent_gateway import (
    get_enrollment_key_virtual_key_decrypted,
    list_all_active_enrollment_keys,
    record_enrollment_key_verification,
)
from proliferate.integrations import litellm
from proliferate.integrations.sentry import report_critical
from proliferate.lib.infra.time.wall_clock import utcnow

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VerificationResult:
    """Summary of one verification tick, returned for logging/tests."""

    checked: int
    ok: int
    misconfigured: int
    errored: int


async def run_verification(db: AsyncSession) -> VerificationResult:
    """Verify every active enrollment key's gateway model access, once.

    Never raises for a single bad key: a per-key failure is reported and skipped
    so the rest of the tick still runs, and it records no verdict.
    """
    keys = await list_all_active_enrollment_keys(db)
    ok = 0
    misconfigured = 0
    errored = 0
    for key in keys:
        virtual_key = await get_enrollment_key_virtual_key_decrypted(
            db, enrollment_key_id=key.id
        )
        if virtual_key is None:
            # No stored key material to check yet (a freshly created, not-yet-minted
            # row). Nothing to verify; leave any prior verdict standing.
            continue
        try:
            models = await litellm.list_models(virtual_key=virtual_key)
        except Exception as exc:  # noqa: BLE001 - one bad key must not abort the tick
            errored += 1
            report_critical(
                exc,
                tags={
                    "domain": "agent_gateway",
                    "action": "verification",
                    "harness_kind": key.harness_kind,
                    "enrollment_key_id": str(key.id),
                },
            )
            continue
        now = utcnow()
        if models:
            await record_enrollment_key_verification(
                db,
                enrollment_key_id=key.id,
                status=AGENT_GATEWAY_VERIFICATION_STATUS_OK,
                delta=None,
                verified_at=now,
            )
            ok += 1
        else:
            delta = json.dumps(
                {"reason": "empty_model_list", "harness_kind": key.harness_kind}
            )
            await record_enrollment_key_verification(
                db,
                enrollment_key_id=key.id,
                status=AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED,
                delta=delta,
                verified_at=now,
            )
            misconfigured += 1
    return VerificationResult(
        checked=len(keys),
        ok=ok,
        misconfigured=misconfigured,
        errored=errored,
    )
