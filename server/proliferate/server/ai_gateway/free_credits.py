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
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.billing_subjects import (
    count_agent_gateway_free_credit_allocations_for_subject,
    ensure_agent_gateway_free_credit_allocation,
    ensure_organization_billing_subject,
    get_agent_gateway_free_credit_allocation_owner,
    get_linked_github_provider_user_id,
    move_agent_gateway_free_credit_allocation,
)
from proliferate.integrations.sentry import report_critical
from proliferate.lib.infra.time.wall_clock import utcnow

logger = logging.getLogger(__name__)


class AgentGatewayReclaimLedgerRaced(Exception):
    """The orphan's ledger changed between the purity read and the move.

    Raised (not just reported) so the reclaim transaction rolls back: money
    the preconditions never vetted must not stay moved. A can't-happen guard —
    the purity read locks the rows it saw, so reaching this means a grant was
    INSERTed into the window.
    """


class AgentGatewayZeroGrantEnrollments(Exception):
    """Active org enrollments past the cutoff still hold zero credit grants.

    Constructed (never raised) into ``report_critical`` by
    ``run_zero_grant_check`` when the self-heal attempt could not land a
    grant — the ops alert for the "silently unfunded org" failure class.
    """


@dataclass(frozen=True)
class ZeroGrantCheckResult:
    """Summary of one zero-grant guard pass, returned for logging/tests.

    ``healed`` counts enrollments whose grant landed this pass; ``alerted``
    counts ORGS newly paged this pass (still-grantless, pageable, and not in
    the caller's already-alerted set). Classified-unhealable enrollments and
    repeat orgs appear in neither — they are logged, never paged.
    """

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
    github_provider_user_id: str,
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

    Reclaims ONLY when the move is PROVABLY identity-pure — every
    precondition below must hold, because ``move_llm_credit_ledger`` moves a
    SUBJECT's whole ledger, not one identity's slice:

    P1. the identity's allocation is owned by a DIFFERENT subject than the
        caller's default org, that owner is an organization-kind billing
        subject (a personal-kind claimant is pre-migration residue the D-3
        migration converges — never reclaimed here), and the owning org has
        ZERO active memberships. A live second account on the same identity
        keeps an active membership in its claiming org, so it still gets
        nothing — the anti-abuse dedupe behaving correctly, refused silently.
    P2. the orphan's ledger holds NOTHING but the identity's own signup
        grant: zero grant rows, or exactly one with ``source == free_signup``
        and ``source_ref == free_signup:<orphan-subject-id>``. Any topup /
        admin / seat_pool row means real paid money whose ownership cannot be
        proven to be this identity's — refuse.
    P3. the orphan holds exactly ONE agent-gateway free-credit allocation and
        it is THIS identity's — a second human's claim riding the same
        subject must never be dragged along.
    P4. the destination subject holds no ``free_signup`` grant already — the
        moved grant's ``source_ref`` rewrite is skipped when the destination
        ref is taken, and moving anyway would leave two free_signup rows.

    P2 and P4 both read ``FOR UPDATE``: the move is an unfiltered subject-wide
    UPDATE on the source AND lands rows on the destination, so both sides need
    the rows they vetted held for the transaction. Row locks cannot cover an
    INSERT that has not happened yet, so three post-move invariants back them
    up — moved grants never exceed the observed source grants, moved usage
    rows equal the observed source usage rows, and the destination ends with
    at most one ``free_signup`` row. Any violation raises
    :class:`AgentGatewayReclaimLedgerRaced` and rolls the reclaim back.

    A P1 failure is the normal dedupe path and stays silent. An orphan that
    fails P2–P4 is refused with ONE ``logger.error`` naming the ids and the
    reason — the manual-resolution path, deliberately non-paging.

    Under P1–P4 the D-3 primitives are exactly correct, in their order: the
    whole ledger moves first (``move_llm_credit_ledger`` rewrites the
    free_signup ``source_ref`` onto the destination so the follow-up grant
    CONVERGES instead of duplicating, usage debits riding along), then the
    allocation claim re-points — identity-filtered, defense in depth on top
    of P3. Returns True when the caller may retry the reserve.
    """
    owner = await get_agent_gateway_free_credit_allocation_owner(
        db,
        github_provider_user_id=github_provider_user_id,
        period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    )
    # P1 — anything short of an orphaned org-kind claimant is not a reclaim
    # shape at all: silent refusal, the dedupe (or D-3) owns it.
    if owner is None or owner.id == default_org_subject.id:
        return False
    if owner.kind != BILLING_SUBJECT_KIND_ORGANIZATION or owner.organization_id is None:
        return False
    if await organization_store.list_organization_members(db, owner.organization_id):
        return False
    # P2–P4 — the orphan must be provably identity-pure before money moves.
    # The source read LOCKS the rows it observes: the move below is an
    # unfiltered subject-wide UPDATE, so a grant committed between this read
    # and that UPDATE would otherwise be swept along (TOCTOU).
    refusal_reason: str | None = None
    orphan_grants = await agent_gateway_store.list_llm_credit_grants(db, owner.id, for_update=True)
    own_signup_ref = f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{owner.id}"
    ledger_is_pure = not orphan_grants or (
        len(orphan_grants) == 1
        and orphan_grants[0].source == LLM_CREDIT_SOURCE_FREE_SIGNUP
        and orphan_grants[0].source_ref == own_signup_ref
    )
    orphan_allocations = await count_agent_gateway_free_credit_allocations_for_subject(
        db, billing_subject_id=owner.id
    )
    own_allocations = await count_agent_gateway_free_credit_allocations_for_subject(
        db,
        billing_subject_id=owner.id,
        github_provider_user_id=github_provider_user_id,
    )
    orphan_usage_events = await agent_gateway_store.count_usage_events_for_subject(db, owner.id)
    # P4's read LOCKS the destination's grants for the same reason P2 locks the
    # source's: a free_signup grant committed on the DESTINATION between this
    # check and the move slips through every other guard — the move's
    # source_ref rewrite correctly declines (the ref is taken), the moved count
    # still matches the source, and the moved row lands BESIDE the existing one.
    destination_grants = await agent_gateway_store.list_llm_credit_grants(
        db, default_org_subject.id, for_update=True
    )
    if not ledger_is_pure:
        refusal_reason = "orphan_ledger_not_identity_pure"
    elif orphan_allocations == 0:
        # Lost a concurrent race for the same claim (the winner already moved
        # it) — distinct from holding SOMEONE ELSE's claim, which is what
        # "foreign" means. Naming them the same misleads triage.
        refusal_reason = "orphan_allocation_already_moved"
    elif orphan_allocations != 1 or own_allocations != 1:
        refusal_reason = "orphan_holds_foreign_allocations"
    elif any(grant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP for grant in destination_grants):
        refusal_reason = "destination_already_has_free_signup"
    if refusal_reason is not None:
        logger.error(
            "Agent gateway orphan reclaim refused; manual resolution required",
            extra={
                "reason": refusal_reason,
                "user_id": str(user_id),
                "orphan_billing_subject_id": str(owner.id),
                "orphan_organization_id": str(owner.organization_id),
                "default_org_billing_subject_id": str(default_org_subject.id),
            },
        )
        return False
    moved_grants, moved_usage = await agent_gateway_store.move_llm_credit_ledger(
        db,
        from_billing_subject_id=owner.id,
        to_billing_subject_id=default_org_subject.id,
    )
    # Can't-happen belts behind the FOR UPDATE reads above: a row that appeared
    # after a vetting read (an INSERT no row lock can prevent) has just been
    # moved, or moved onto, with money we never vetted. Each raises so the whole
    # reclaim transaction rolls back — nothing moves — and pages, because a
    # silent partial reclaim is exactly the class of bug the preconditions exist
    # to prevent.
    raced: str | None = None
    if moved_grants > len(orphan_grants):
        raced = (
            f"observed {len(orphan_grants)} grant(s) on source {owner.id} but moved {moved_grants}"
        )
    elif moved_usage != orphan_usage_events:
        # The debit side moves too, so an imported usage row landing in the
        # window would ride along unvetted (it would silently reduce the
        # destination's credit).
        raced = (
            f"observed {orphan_usage_events} usage row(s) on source {owner.id} "
            f"but moved {moved_usage}"
        )
    else:
        destination_signups = [
            grant
            for grant in await agent_gateway_store.list_llm_credit_grants(
                db, default_org_subject.id
            )
            if grant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP
        ]
        if len(destination_signups) > 1:
            # The F1 shape: a free_signup grant appeared on the DESTINATION in
            # the window, so the move's source_ref rewrite declined and the
            # moved row landed beside it — the one place in this path where
            # money could increase without entitlement.
            raced = (
                f"destination {default_org_subject.id} holds "
                f"{len(destination_signups)} free_signup grants after the move"
            )
    if raced is not None:
        error = AgentGatewayReclaimLedgerRaced(f"orphan reclaim raced: {raced}; rolled back")
        report_critical(
            error,
            tags={"domain": "agent_gateway", "action": "orphan_reclaim"},
        )
        raise error
    moved_allocations = await move_agent_gateway_free_credit_allocation(
        db,
        from_billing_subject_id=owner.id,
        to_billing_subject_id=default_org_subject.id,
        github_provider_user_id=github_provider_user_id,
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
        # billing subject. When that other subject is a PROVABLY identity-pure
        # orphan a deleted account left behind, the claim is reclaimed and the
        # reserve retried; every other claimant shape means no credit here.
        github_provider_user_id = await get_linked_github_provider_user_id(db, user_id)
        if github_provider_user_id is None:
            return False
        if not await _reclaim_orphaned_allocation(
            db,
            user_id=user_id,
            github_provider_user_id=github_provider_user_id,
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


async def _classify_unhealable(
    db: AsyncSession,
    enrollment: AgentGatewayEnrollmentRecord,
) -> str | None:
    """Why a still-grantless enrollment must NOT page, or ``None`` (pageable).

    Two shapes are legitimately never self-healable and would otherwise page
    forever: ``no_github_identity`` (the dedupe is GitHub-keyed — a signup
    without a linked identity has nothing to grant against) and
    ``non_default_org`` (the grant lands only on the member's DEFAULT org, so
    an invitee org's subject never receives one by design). Both are logged
    by the caller and excluded from paging.
    """
    if enrollment.user_id is None:
        return "no_github_identity"
    if await get_linked_github_provider_user_id(db, enrollment.user_id) is None:
        return "no_github_identity"
    default_org = await organization_store.get_default_organization_for_user(
        db, enrollment.user_id
    )
    if default_org is None or default_org.organization.id != enrollment.organization_id:
        return "non_default_org"
    return None


async def run_zero_grant_check(
    db: AsyncSession,
    *,
    max_age_seconds: int = 3600,
    limit: int = 50,
    already_alerted_org_ids: set[UUID] | None = None,
) -> ZeroGrantCheckResult:
    """Sweep aged zero-grant org enrollments: self-heal, classify, then page.

    The guard the delivery spec mandates behind the signup-grant fix: an
    active org enrollment older than ``max_age_seconds`` whose billing
    subject holds zero ``llm_credit_grant`` rows should not exist — the grant
    lands in the same flow as the enrollment. The feed is newest-first so
    fresh breakage is never starved by old unhealable rows at the ``limit``.

    Each listed enrollment gets the (orphan-aware)
    ``ensure_signup_free_credit_grant`` re-attempted. What stays grantless is
    CLASSIFIED before anything pages (see ``_classify_unhealable``); the
    pageable remainder raises at most ONE aggregated ``report_critical`` per
    pass, covering only orgs NOT already in ``already_alerted_org_ids`` —
    the caller-owned set is mutated in place, so a worker passing a
    process-lifetime set pages each broken org exactly once per process
    (a restart re-pages once; accepted). Repeat orgs log a warning instead.
    Orgs that stop being broken are evicted from that set, so an org which
    breaks, heals, and breaks again pages once per break rather than being
    silenced for the process's lifetime.
    """
    cutoff = utcnow() - timedelta(seconds=max_age_seconds)
    listed = await agent_gateway_store.list_active_org_enrollments_with_zero_grants(
        db,
        older_than=cutoff,
        limit=limit,
    )
    if not listed:
        # Nothing is broken: every org previously paged has since been funded
        # (in-pass or out of band), so the whole suppression set is stale.
        if already_alerted_org_ids is not None:
            already_alerted_org_ids.clear()
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
    pageable: list[AgentGatewayEnrollmentRecord] = []
    for enrollment in listed:
        if enrollment.id not in still_grantless_ids:
            continue
        reason = await _classify_unhealable(db, enrollment)
        if reason is not None:
            logger.warning(
                "Agent gateway zero-grant enrollment is not self-healable; not paging",
                extra={
                    "reason": reason,
                    "enrollment_id": str(enrollment.id),
                    "organization_id": str(enrollment.organization_id),
                    "user_id": str(enrollment.user_id),
                },
            )
            continue
        pageable.append(enrollment)
    pageable_org_ids = sorted(
        {e.organization_id for e in pageable if e.organization_id is not None}, key=str
    )
    healed_org_ids = tuple(
        sorted({e.organization_id for e in healed if e.organization_id is not None}, key=str)
    )
    known = already_alerted_org_ids if already_alerted_org_ids is not None else set()
    # An org that is no longer broken must leave the suppression set, so a later
    # RE-break pages once more instead of being silenced for the process's life.
    # Healing in this pass is one way; healing out of band (an admin grant, a
    # top-up) is the other — such an org simply stops appearing as pageable.
    if len(listed) < limit:
        # The pass saw the WHOLE backlog, so absence from `pageable_org_ids`
        # proves funded.
        known.difference_update(known - set(pageable_org_ids))
    elif known:
        # TRUNCATED feed: absence proves nothing (the org may sit beyond the
        # limit window), so ask directly about the orgs being suppressed —
        # otherwise an out-of-band-healed org would never leave the set and its
        # re-break would be silenced forever.
        still_broken = set(
            await agent_gateway_store.list_organization_ids_with_zero_grant_active_enrollments(
                db,
                organization_ids=sorted(known, key=str),
            )
        )
        known.intersection_update(still_broken)
    new_org_ids = tuple(org_id for org_id in pageable_org_ids if org_id not in known)
    repeat_org_ids = tuple(org_id for org_id in pageable_org_ids if org_id in known)
    if new_org_ids:
        known.update(new_org_ids)
        report_critical(
            AgentGatewayZeroGrantEnrollments(
                f"{len(new_org_ids)} org(s) with enrollments older than "
                f"{max_age_seconds}s still hold zero LLM credit grants after "
                "the self-heal attempt"
            ),
            tags={"domain": "agent_gateway", "action": "zero_grant_check"},
            extras={
                # The count is the message's and the log's job — only the org
                # ids ride the Sentry extras, matching the privacy allowlist.
                "zero_grant_organization_ids": [str(org_id) for org_id in new_org_ids],
            },
        )
        logger.error(
            "Agent gateway zero-grant enrollments could not be healed",
            extra={
                "count": len(new_org_ids),
                "organization_ids": [str(org_id) for org_id in new_org_ids],
            },
        )
    if repeat_org_ids:
        logger.warning(
            "Agent gateway zero-grant orgs already paged this process; suppressing repeat",
            extra={"organization_ids": [str(org_id) for org_id in repeat_org_ids]},
        )
    return ZeroGrantCheckResult(
        checked=len(listed),
        healed=len(healed),
        alerted=len(new_org_ids),
        healed_organization_ids=healed_org_ids,
        alerted_organization_ids=new_org_ids,
    )
