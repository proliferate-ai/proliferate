"""D-3 enrollment migration: re-parent pre-org-only residue onto default orgs.

The org-only account model (model-gateway.md §Account model) leaves two kinds
of pre-cut residue in existing deployments, and this module is the idempotent,
resumable backfill that converts both. It runs ahead of the ordinary
enrollment backfill on every worker tick (``worker.run_enrollment_backfill_once``)
and converges to a no-op once nothing is left to convert — the B2 precedent:
data conversion that needs the LiteLLM admin API lives in a worker pass, never
inline in an alembic migration.

1. **Personal enrollments** (``subject_kind='user'``, one ``user-<uuid>``
   LiteLLM team/user): the user's whole LLM ledger (credit grants AND imported
   usage debits — remaining credit is preserved exactly, never duplicated) and
   the GitHub-identity free-credit allocation move to the default org's
   billing subject, the org enrollment is ensured (per-harness keys minted
   under the per-(org, member) ``org-<org>-user-<uuid>`` LiteLLM user), the
   personal row's LiteLLM keys are deleted on the proxy (tolerating
   already-deleted), and the personal row is retired (revoked, not deleted —
   spend attribution for pre-migration usage still resolves through it).

2. **Pre-D-2 org enrollments** whose keys were minted under the old shared
   ``user-<uuid>`` LiteLLM identity: fed back through
   ``ensure_org_enrollment``, where the key-set fingerprint (which covers the
   LiteLLM user identity) reopens them and the per-key fingerprint check
   revokes the old keys and re-mints under ``org-<org>-user-<uuid>``.

Each row converts independently: a failure (or a user with no default org
yet) leaves that row active for the next tick and never blocks the rest.
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import AGENT_GATEWAY_SYNC_STATUS_SYNCED
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    move_agent_gateway_free_credit_allocation,
)
from proliferate.integrations import litellm
from proliferate.server.ai_gateway.enrollment import (
    _parse_budget,
    _remaining_credit_budget_raw,
    ensure_org_enrollment,
)

logger = logging.getLogger(__name__)


async def migrate_legacy_enrollments(db: AsyncSession, *, limit: int = 50) -> int:
    """One bounded migration pass; returns the number of rows converted.

    Personal rows first (they are the ones a session could still resolve
    nothing for), then the stale-identity org sweep with whatever budget is
    left. Both listings shrink as rows convert, so repeated ticks walk the
    whole backlog and the pass settles into a cheap empty-select no-op.
    """
    if not settings.agent_gateway_enabled:
        return 0
    converted = 0
    personal = await agent_gateway_store.list_active_personal_enrollments(db, limit=limit)
    for enrollment in personal:
        if await _migrate_personal_enrollment(db, enrollment):
            converted += 1

    remaining = limit - len(personal)
    if remaining <= 0:
        return converted
    stale = await agent_gateway_store.list_stale_identity_org_enrollments(db, limit=remaining)
    for enrollment in stale:
        if enrollment.organization_id is None or enrollment.user_id is None:
            continue
        # The fingerprint machinery does the actual work: the stored key-set
        # fingerprint cannot match a material that includes the per-(org,
        # member) LiteLLM user, so the row reopens and the sync revokes +
        # re-mints each key minted under the shared `user-<uuid>` identity.
        resynced = await ensure_org_enrollment(db, enrollment.organization_id, enrollment.user_id)
        if resynced.litellm_user_id is not None and resynced.litellm_user_id.startswith("org-"):
            converted += 1
    return converted


async def _migrate_personal_enrollment(
    db: AsyncSession,
    enrollment: AgentGatewayEnrollmentRecord,
) -> bool:
    """Convert one personal enrollment onto the user's default org.

    Ordering is chosen so every step is safe to re-run after a crash:

    1. move the ledger + allocation (pure DB, idempotent — a re-run finds
       nothing left on the personal subject),
    2. ensure the org enrollment (idempotent; the freshly moved balance is
       what its team-budget mirror and free-credit dedupe see),
    3. delete the personal row's LiteLLM keys on the proxy (tolerates
       already-deleted keys), and
    4. retire the personal row (revoke, not delete — pre-migration spend
       still resolves through it for attribution).

    A user with no default org yet cannot be converted; the row stays active
    and the next tick retries (signup always creates the default org, so this
    is transient residue at worst).
    """
    if enrollment.user_id is None:
        logger.warning(
            "Personal gateway enrollment carries no user; leaving for manual review",
            extra={"enrollment_id": str(enrollment.id)},
        )
        return False
    default_org = await organization_store.get_default_organization_for_user(
        db, enrollment.user_id
    )
    if default_org is None:
        logger.info(
            "Personal gateway enrollment migration deferred: user has no default org yet",
            extra={
                "enrollment_id": str(enrollment.id),
                "user_id": str(enrollment.user_id),
            },
        )
        return False
    organization_id = default_org.organization.id
    org_subject = await ensure_organization_billing_subject(db, organization_id)

    # 1. Convert the claim + the money. Grants AND usage debits move, so the
    # org subject's remaining credit equals what the personal subject had —
    # preserved, never duplicated. The allocation move flips the
    # GitHub-identity dedupe from "claimed by the personal subject (blocks the
    # org grant)" to "claimed by the org subject (org-path grant converges)".
    moved_grants, moved_usage = await agent_gateway_store.move_llm_credit_ledger(
        db,
        from_billing_subject_id=enrollment.billing_subject_id,
        to_billing_subject_id=org_subject.id,
    )
    moved_allocations = await move_agent_gateway_free_credit_allocation(
        db,
        from_billing_subject_id=enrollment.billing_subject_id,
        to_billing_subject_id=org_subject.id,
    )

    # 2. The org-side shape: team, per-(org, member) LiteLLM user, per-harness
    # keys. A LiteLLM failure here marks the ORG row failed and the ordinary
    # backfill retries it; the personal row is still retired below — the money
    # already lives on the org subject, so leaving the personal keys live
    # would let spend land on a subject with no credit behind it.
    org_enrollment = await ensure_org_enrollment(db, organization_id, enrollment.user_id)

    # An org enrollment that was ALREADY synced short-circuits its sync pass,
    # so its LiteLLM team budget still mirrors the pre-migration (unfunded)
    # balance — which would block the org's keys even though the converted
    # credit now backs them. Rewrite the mirror from the post-move ledger.
    # `_remaining_credit_budget_raw` never yields a value LiteLLM would read
    # as uncapped, so this can only move the cap to the funded balance (or
    # the exhausted floor), never open it. Overage-enabled subjects keep
    # their uncapped team (the top-up loop is their guardrail).
    if (
        org_enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED
        and org_enrollment.litellm_team_id is not None
        and not org_subject.overage_enabled
    ):
        budget_raw = await _remaining_credit_budget_raw(
            db,
            billing_subject_id=org_subject.id,
            fallback=settings.agent_gateway_default_org_budget_usd,
        )
        await litellm.update_team_budget(
            team_id=org_enrollment.litellm_team_id,
            max_budget=_parse_budget(budget_raw),
        )

    # 3. Revoke the personal shape's LiteLLM keys on the proxy: the per-harness
    # child keys, plus any pre-B2 unscoped key still on the parent row.
    # `delete_virtual_key` tolerates a key LiteLLM no longer has (a retried
    # delete whose DB write rolled back), so this never wedges the pass.
    for enrollment_key in await agent_gateway_store.list_active_enrollment_keys(
        db,
        enrollment_id=enrollment.id,
    ):
        if enrollment_key.virtual_key_id is not None:
            await litellm.delete_virtual_key(key_or_token_id=enrollment_key.virtual_key_id)
    if enrollment.virtual_key_id is not None:
        await litellm.delete_virtual_key(key_or_token_id=enrollment.virtual_key_id)

    # 4. Retire (disable-not-delete): the row and its child key rows keep
    # existing for pre-migration spend attribution, but drop out of every
    # active-enrollment listing — including this migration's own feed, which
    # is what makes a re-run a no-op.
    await agent_gateway_store.revoke_enrollment(db, enrollment_id=enrollment.id)
    logger.info(
        "Migrated personal gateway enrollment onto the default org",
        extra={
            "enrollment_id": str(enrollment.id),
            "user_id": str(enrollment.user_id),
            "organization_id": str(organization_id),
            "moved_grants": moved_grants,
            "moved_usage_events": moved_usage,
            "moved_allocations": moved_allocations,
        },
    )
    return True
