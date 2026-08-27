"""Free LLM credits granted at signup (model-gateway.md §Billing integration).

Every new human gets a one-time ``settings.agent_gateway_free_credit_usd``
grant landing on their DEFAULT ORG's billing subject — orgs are the only
billing subject, and a "personal org" is just the default org created at
signup that nobody else has joined. The grant is deduped through
``free_cloud_allocation`` (the same anti-abuse guard the compute free trial
uses, keyed on the linked GitHub identity): one grant per human, ever. A
second account on the same GitHub identity gets nothing, creating additional
orgs mints nothing, and a joining member never brings their grant into
another org — it stays on their default org forever, which is what keeps
invite-farming worthless. The grant is the credit side of the LLM ledger;
the LiteLLM team budget then mirrors the remaining credit so the proxy
hard-stops when the ledger is spent.

One claimant shape is reclaimed rather than refused: an allocation stranded
on a DELETED account's orphaned org (the 2026-08 founder-org incident — see
``_reclaim_orphaned_allocation``). Everything the dedupe is actually for (a
live second account on the same identity) still gets nothing.

``run_zero_grant_check`` is the guard behind the fix: the backfill worker
sweeps aged active org enrollments whose subject holds zero grant rows,
re-attempts the (now orphan-aware) grant, and raises one ops alert per tick
for whatever stays grantless — a silent skip can no longer be permanent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    LLM_CREDIT_SOURCE_FREE_SIGNUP,
)
from proliferate.constants.billing import BILLING_SUBJECT_KIND_ORGANIZATION
from proliferate.db.models.billing import BillingSubject
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.billing_subjects import (
    ensure_agent_gateway_free_credit_allocation,
    ensure_organization_billing_subject,
    get_agent_gateway_free_credit_allocation_owner,
    move_agent_gateway_free_credit_allocation,
)
from proliferate.integrations.sentry import report_critical
from proliferate.lib.infra.time.wall_clock import utcnow

logger = logging.getLogger(__name__)


class AgentGatewayZeroGrantEnrollments(Exception):
    """Active org enrollments past the cutoff still hold zero credit grants.

    Constructed (never raised) into ``report_critical`` by
    ``run_zero_grant_check`` when the self-heal attempt could not land a
    grant — the ops alert for the "silently unfunded org" failure class.
    """


@dataclass(frozen=True)
class ZeroGrantCheckResult:
    """Summary of one zero-grant guard pass, returned for logging/tests."""

    checked: int
    healed: int
    alerted: int
    healed_organization_ids: tuple[UUID, ...]
    alerted_organization_ids: tuple[UUID, ...]


def free_credit_amount_usd() -> Decimal:
    """Configured free-credit amount; non-positive means the grant is off."""
    try:
        amount = Decimal(settings.agent_gateway_free_credit_usd)
    except (ArithmeticError, ValueError):
        return Decimal("0")
    return amount if amount > 0 else Decimal("0")


async def _reclaim_orphaned_allocation(
    db: AsyncSession,
    *,
    user_id: UUID,
    default_org_subject: BillingSubject,
) -> bool:
    """Reclaim the identity's free-credit claim from a deleted account's orphan.

    Root cause of the founder-org zero-grant incident (prod forensics,
    2026-08-26): the founder deleted his first account, but the one-per-
    GitHub-identity ``free_cloud_allocation`` SURVIVED, still owned by the
    deleted account's now-orphaned org billing subject (org row alive, zero
    memberships). On re-signup with the same GitHub identity the allocation
    reserve returned False ("claimed elsewhere"), the grant silently
    skipped — and because a SYNCED enrollment is never revisited by the
    backfill, the skip was permanent.

    Reclaims ONLY under exactly these conditions, checked in order:

    1. the identity's allocation exists and is owned by a DIFFERENT subject
       than the caller's default org (otherwise there is nothing to reclaim);
    2. that owner is an organization-kind billing subject (a personal-kind
       claimant is pre-migration residue the D-3 migration converges — never
       reclaimed here); and
    3. the owning organization has ZERO active memberships — the orphan an
       account deletion leaves behind. A live second account on the same
       identity keeps at least one active membership in its claiming org, so
       it still gets nothing: the anti-abuse dedupe is behaving correctly
       there.

    Convergence uses the existing D-3 primitives, in their order: the whole
    ledger moves first (``move_llm_credit_ledger`` rewrites the free_signup
    ``source_ref`` onto the destination subject, so the follow-up grant
    CONVERGES on the moved grant instead of duplicating it — and both grant
    and usage sides move, preserving the remaining balance), then the
    allocation claim re-points. Returns True when the claim now belongs to
    ``default_org_subject`` and the caller may retry the reserve.
    """
    owner = await get_agent_gateway_free_credit_allocation_owner(
        db,
        user_id=user_id,
        period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    )
    if owner is None or owner.id == default_org_subject.id:
        return False
    if owner.kind != BILLING_SUBJECT_KIND_ORGANIZATION or owner.organization_id is None:
        return False
    if await organization_store.list_organization_members(db, owner.organization_id):
        return False
    moved_grants, moved_usage = await agent_gateway_store.move_llm_credit_ledger(
        db,
        from_billing_subject_id=owner.id,
        to_billing_subject_id=default_org_subject.id,
    )
    moved_allocations = await move_agent_gateway_free_credit_allocation(
        db,
        from_billing_subject_id=owner.id,
        to_billing_subject_id=default_org_subject.id,
    )
    logger.info(
        "Agent gateway free-credit claim reclaimed from orphaned org subject",
        extra={
            "user_id": str(user_id),
            "orphan_billing_subject_id": str(owner.id),
            "orphan_organization_id": str(owner.organization_id),
            "default_org_billing_subject_id": str(default_org_subject.id),
            "moved_grants": moved_grants,
            "moved_usage_events": moved_usage,
            "moved_allocations": moved_allocations,
        },
    )
    return True


async def ensure_signup_free_credit_grant(
    db: AsyncSession,
    user_id: UUID,
) -> bool:
    """Grant the one-time free LLM credit onto the user's default org.

    Returns True if the grant exists on the default org's billing subject
    after this call (freshly created or already present). Idempotent: the
    ``free_cloud_allocation`` guard reserves the allocation once per GitHub
    identity, and the credit grant's ``source_ref`` makes the ledger insert
    itself idempotent, so repeated enrollment/backfill passes never
    double-credit. An identity whose allocation is already claimed by a
    LIVE different billing subject (another account, or a pre-migration
    personal subject) gets nothing — one grant per human, ever. The one
    exception is a claim stranded on a deleted account's orphaned org, which
    is reclaimed and converged instead of refused
    (see ``_reclaim_orphaned_allocation``).
    """
    amount = free_credit_amount_usd()
    if amount <= 0:
        return False
    default_org = await organization_store.get_default_organization_for_user(db, user_id)
    if default_org is None:
        # Signup always creates the default org before enrollment runs; an
        # org-less user here is a not-yet-placed identity the backfill worker
        # will revisit once a membership exists.
        return False
    subject = await ensure_organization_billing_subject(db, default_org.organization.id)
    reserved = await ensure_agent_gateway_free_credit_allocation(
        db,
        user_id=user_id,
        billing_subject=subject,
        period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    )
    if not reserved:
        # No linked GitHub identity, or the allocation belongs to another
        # billing subject. When that other subject is an orphan a deleted
        # account left behind, the claim is reclaimed and the reserve
        # retried; every other claimant shape means no credit here.
        if not await _reclaim_orphaned_allocation(
            db,
            user_id=user_id,
            default_org_subject=subject,
        ):
            return False
        reserved = await ensure_agent_gateway_free_credit_allocation(
            db,
            user_id=user_id,
            billing_subject=subject,
            period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
        )
        if not reserved:
            return False
    grant = await agent_gateway_store.create_llm_credit_grant(
        db,
        billing_subject_id=subject.id,
        user_id=user_id,
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=amount,
        source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{subject.id}",
    )
    return grant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP


async def run_zero_grant_check(
    db: AsyncSession,
    *,
    max_age_seconds: int = 3600,
    limit: int = 50,
) -> ZeroGrantCheckResult:
    """Sweep aged zero-grant org enrollments: self-heal, then alert the rest.

    The guard the delivery spec mandates behind the signup-grant fix: an
    active org enrollment older than ``max_age_seconds`` whose billing
    subject holds zero ``llm_credit_grant`` rows should not exist — the grant
    lands in the same flow as the enrollment. Each one gets the (now
    orphan-aware) ``ensure_signup_free_credit_grant`` re-attempted; whatever
    is still grantless afterwards raises ONE ``report_critical`` ops alert
    for the whole tick (count + org ids in the extras) plus a
    ``logger.error`` listing, so a silent skip is loud within the hour
    instead of surfacing as a user's 403 on day 8.
    """
    cutoff = utcnow() - timedelta(seconds=max_age_seconds)
    listed = await agent_gateway_store.list_active_org_enrollments_with_zero_grants(
        db,
        older_than=cutoff,
        limit=limit,
    )
    if not listed:
        return ZeroGrantCheckResult(
            checked=0,
            healed=0,
            alerted=0,
            healed_organization_ids=(),
            alerted_organization_ids=(),
        )
    for enrollment in listed:
        if enrollment.user_id is not None:
            await ensure_signup_free_credit_grant(db, enrollment.user_id)
    listed_ids = {enrollment.id for enrollment in listed}
    still_grantless_ids = {
        enrollment.id
        for enrollment in await agent_gateway_store.list_active_org_enrollments_with_zero_grants(
            db,
            older_than=cutoff,
            limit=limit,
        )
        if enrollment.id in listed_ids
    }
    healed = [e for e in listed if e.id not in still_grantless_ids]
    alerted = [e for e in listed if e.id in still_grantless_ids]
    alerted_org_ids = tuple(
        sorted({e.organization_id for e in alerted if e.organization_id is not None}, key=str)
    )
    if alerted:
        report_critical(
            AgentGatewayZeroGrantEnrollments(
                f"{len(alerted)} active org enrollment(s) older than "
                f"{max_age_seconds}s still hold zero LLM credit grants after "
                "the self-heal attempt"
            ),
            tags={"domain": "agent_gateway", "action": "zero_grant_check"},
            extras={
                "zero_grant_count": len(alerted),
                "zero_grant_organization_ids": [str(org_id) for org_id in alerted_org_ids],
            },
        )
        logger.error(
            "Agent gateway zero-grant enrollments could not be healed",
            extra={
                "count": len(alerted),
                "organization_ids": [str(org_id) for org_id in alerted_org_ids],
            },
        )
    return ZeroGrantCheckResult(
        checked=len(listed),
        healed=len(healed),
        alerted=len(alerted),
        healed_organization_ids=tuple(
            sorted({e.organization_id for e in healed if e.organization_id is not None}, key=str)
        ),
        alerted_organization_ids=alerted_org_ids,
    )
