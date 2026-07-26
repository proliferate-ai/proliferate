"""Eager LiteLLM enrollment for users and organizations.

Every enrollment ensures the durable row first (idempotent), then — when the
gateway is enabled — provisions the LiteLLM team, user, and one
access-group-scoped virtual key per gateway-capable harness_kind (child
``agent_gateway_enrollment_key`` rows; model-gateway.md §Account model), and
marks the enrollment row synced. Failures mark the row failed; the backfill
worker retries pending/failed rows and discovers users created before the
hooks existed.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Sequence
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS,
    AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
    AGENT_GATEWAY_SUBJECT_KIND_USER,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.integrations import litellm
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMVirtualKey
from proliferate.server.cloud.agent_gateway.free_credits import ensure_user_free_credit_grant
from proliferate.server.cloud.materialization import service as materialization_service

logger = logging.getLogger(__name__)

# Every gateway-capable harness gets its own access-group-scoped key at
# enrollment sync (R2, agents-impl-plan.md §4 B2). Exactly
# AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS — cursor is excluded from that
# tuple (no gateway recipe; native-only), unlike the broader
# AGENT_AUTH_HARNESS_KINDS which cursor does belong to.
_GATEWAY_CAPABLE_HARNESS_KINDS = AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS

# When a subject with an active grant has exhausted it, LiteLLM's ``max_budget``
# must mirror a *near-zero* cap rather than "0" — our ``_parse_budget`` reads
# "0"/empty as "uncapped" (the org-default semantics), so flooring at exactly 0
# would mint an unbounded key for an out-of-credit subject. A tiny positive
# floor keeps the key effectively blocked (never unbounded) while the importer
# also disables it on the next tick.
_EXHAUSTED_BUDGET_FLOOR_USD = Decimal("0.01")


def build_sync_fingerprint(*, team_id: str, budget: str, key_alias: str) -> str:
    """Stable hash of the provisioned LiteLLM state, used to detect drift."""
    material = f"{team_id}|{budget}|{key_alias}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def build_enrollment_key_set_fingerprint(
    *,
    team_id: str,
    subject_label: str,
    harness_kinds: Sequence[str],
) -> str:
    """Fingerprint of the whole key *set* an enrollment is expected to hold.

    This is the parent row's ``sync_fingerprint`` and the value
    ``ensure_user_enrollment``/``ensure_org_enrollment`` re-compute and compare
    on every pass: a mismatch flips the row back to ``pending`` so the next
    sync provisions whatever the set is now supposed to contain. It therefore
    covers exactly the three inputs that decide the set's shape:

    * ``team_id`` — the LiteLLM team the keys live under,
    * ``subject_label`` — what every key alias is derived from, and
    * the sorted gateway-capable ``harness_kinds`` — one key per entry.

    It deliberately does NOT cover the mirrored team budget. That mirror moves
    with every spend and top-up and is already rewritten by the importer and
    top-up loops; folding it in would re-sync on every login while repairing
    nothing the sync path owns. Per-key drift (a key's own alias) is tracked
    separately on each child row via :func:`build_sync_fingerprint`.
    """
    material = f"{team_id}|{subject_label}|{','.join(sorted(harness_kinds))}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def build_enrollment_key_fingerprint(*, team_id: str, key_alias: str) -> str:
    """Fingerprint of one child key's provisioned identity (team + its alias).

    Per-key counterpart of :func:`build_enrollment_key_set_fingerprint`. Every
    writer of a child row computes it from that row's *current* team and alias
    — a re-mint must never copy the previous row's value forward, or the stored
    fingerprint would describe state the key no longer has.
    """
    return build_sync_fingerprint(team_id=team_id, budget="", key_alias=key_alias)


def _parse_budget(raw: str) -> float | None:
    """Budget settings are strings; "0"/empty means uncapped (no budget sent)."""
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _key_alias(enrollment_id: UUID, subject_label: str, harness_kind: str) -> str:
    """Deterministic per-(enrollment, harness) LiteLLM key alias.

    ``vk-{subject}-{harness}-{id[:8]}`` (R2, agents-impl-plan.md §4 B2). The
    enrollment id (not the child key's own id) is the stable component, so the
    alias for a given (enrollment, harness) pair never changes across resyncs
    — required for the duplicate-alias orphan-recovery path in
    :func:`_mint_virtual_key_idempotent` to keep finding the same alias.
    """
    return f"vk-{subject_label}-{harness_kind}-{str(enrollment_id)[:8]}"


def _is_duplicate_alias_error(error: LiteLLMIntegrationError) -> bool:
    """A 400 whose message mentions the alias == LiteLLM rejecting a dup alias."""
    return error.status_code == 400 and "alias" in error.message.lower()


async def _mint_virtual_key_idempotent(
    *,
    user_id: str,
    team_id: str,
    alias: str,
    metadata: dict[str, str],
    models: list[str],
) -> LiteLLMVirtualKey:
    """Mint an access-group-scoped virtual key, tolerating an orphaned alias.

    Per-harness keys never carry a budget (R2: the team is the only budget
    layer; model-gateway.md §Account model) — ``max_budget`` is never passed
    here, unlike the parent enrollment's team-level budget. ``models`` grants
    exactly the caller's harness access group.

    The alias is deterministic per (enrollment, harness), so a crash/rollback
    after a prior mint (id never committed) leaves a live key we no longer
    track. On the duplicate-alias 400 we purge that orphan and re-mint,
    guaranteeing the enrollment ends up owning a key we also hold the raw
    secret for.
    """
    try:
        return await litellm.mint_virtual_key(
            user_id=user_id,
            team_id=team_id,
            alias=alias,
            metadata=metadata,
            models=models,
        )
    except LiteLLMIntegrationError as error:
        if not _is_duplicate_alias_error(error):
            raise
        await litellm.delete_virtual_keys_by_alias(alias=alias)
        return await litellm.mint_virtual_key(
            user_id=user_id,
            team_id=team_id,
            alias=alias,
            metadata=metadata,
            models=models,
        )


def enrollment_subject_label(enrollment: AgentGatewayEnrollmentRecord) -> str:
    if enrollment.user_id is not None:
        return f"user-{enrollment.user_id}"
    return f"org-{enrollment.organization_id}"


def enrollment_key_alias(enrollment: AgentGatewayEnrollmentRecord, harness_kind: str) -> str:
    """The globally-unique LiteLLM key alias an enrollment's per-harness key was minted with."""
    return _key_alias(enrollment.id, enrollment_subject_label(enrollment), harness_kind)


def enrollment_key_metadata(
    enrollment: AgentGatewayEnrollmentRecord, harness_kind: str
) -> dict[str, str]:
    """Attribution metadata stamped on every per-harness virtual key we mint."""
    metadata: dict[str, str] = {
        "proliferate_billing_subject_id": str(enrollment.billing_subject_id),
        "proliferate_harness_kind": harness_kind,
    }
    if enrollment.user_id is not None:
        metadata["proliferate_user_id"] = str(enrollment.user_id)
    if enrollment.organization_id is not None:
        metadata["proliferate_organization_id"] = str(enrollment.organization_id)
    metadata.update(_qualification_run_metadata())
    return metadata


def _qualification_run_metadata() -> dict[str, str]:
    run_id = settings.agent_gateway_qualification_run_id.strip()
    shard_id = settings.agent_gateway_qualification_shard_id.strip()
    if not run_id:
        return {}
    return {
        "proliferate_qualification_run_id": run_id,
        "proliferate_qualification_shard_id": shard_id,
    }


async def _reopen_if_key_set_drifted(
    db: AsyncSession,
    enrollment: AgentGatewayEnrollmentRecord,
    *,
    subject_label: str,
) -> AgentGatewayEnrollmentRecord:
    """Flip a synced enrollment back to ``pending`` when its key set drifted.

    This is what makes the fingerprint an actual mechanism rather than a
    write-only column: the expected set is recomputed from today's inputs
    (:func:`build_enrollment_key_set_fingerprint`) and compared to what the row
    was last synced against. A mismatch — a new gateway-capable harness kind,
    a moved team, a changed subject label — reopens the row so ``_sync_enrollment``
    mints whatever is missing on the next pass (each per-harness mint is
    idempotent, so nothing already present is re-minted).

    A row that never recorded a fingerprint is left alone: pre-fingerprint rows
    would otherwise re-sync forever with nothing to fix.
    """
    if enrollment.sync_status != AGENT_GATEWAY_SYNC_STATUS_SYNCED:
        return enrollment
    if enrollment.sync_fingerprint is None or enrollment.litellm_team_id is None:
        return enrollment
    expected = build_enrollment_key_set_fingerprint(
        team_id=enrollment.litellm_team_id,
        subject_label=subject_label,
        harness_kinds=_GATEWAY_CAPABLE_HARNESS_KINDS,
    )
    if expected == enrollment.sync_fingerprint:
        return enrollment
    logger.info(
        "Agent gateway enrollment key set drifted; reopening for sync",
        extra={
            "enrollment_id": str(enrollment.id),
            "subject_kind": enrollment.subject_kind,
        },
    )
    return await agent_gateway_store.mark_enrollment_pending(
        db,
        enrollment_id=enrollment.id,
    )


async def ensure_user_enrollment(
    db: AsyncSession,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    subject = await ensure_personal_billing_subject(db, user_id)
    enrollment = await agent_gateway_store.ensure_enrollment_row(
        db,
        subject_kind=AGENT_GATEWAY_SUBJECT_KIND_USER,
        billing_subject_id=subject.id,
        user_id=user_id,
    )
    if not settings.agent_gateway_enabled:
        return enrollment
    # Grant free credits (deduped) before syncing so the LiteLLM budget can
    # mirror the resulting remaining balance. Runs every pass; idempotent.
    await ensure_user_free_credit_grant(db, user_id)
    enrollment = await _reopen_if_key_set_drifted(
        db,
        enrollment,
        subject_label=f"user-{user_id}",
    )
    if enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED:
        return enrollment
    budget_raw = await _remaining_credit_budget_raw(
        db,
        billing_subject_id=subject.id,
        fallback=settings.agent_gateway_default_user_budget_usd,
    )
    return await _sync_enrollment(
        db,
        enrollment=enrollment,
        team_alias=f"user-{user_id}",
        litellm_user_id=f"user-{user_id}",
        subject_label=f"user-{user_id}",
        budget_raw=budget_raw,
    )


async def _remaining_credit_budget_raw(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    fallback: str,
) -> str:
    """Budget string mirroring remaining LLM credit.

    When the subject has any active credit grant, the LiteLLM budget mirrors
    the remaining balance, floored at a tiny positive value so an exhausted
    subject gets a near-zero (blocked) cap rather than "0" — which
    ``_parse_budget`` would read as uncapped. With no grant at all — e.g. free
    credits disabled or no linked GitHub identity — fall back to the default
    user budget so gateway access is not silently uncapped-to-zero.
    """
    balance = await agent_gateway_store.get_remaining_credit_usd(db, billing_subject_id)
    if balance.granted_usd <= 0:
        return fallback
    remaining = balance.remaining_usd
    if remaining <= _EXHAUSTED_BUDGET_FLOOR_USD:
        remaining = _EXHAUSTED_BUDGET_FLOOR_USD
    return str(remaining)


async def ensure_org_enrollment(
    db: AsyncSession,
    organization_id: UUID,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    """Enroll one member under the org team.

    Per spec §2.3 the virtual key is per (user, team): every org member gets
    their own key under the shared org team/budget so gateway spend is
    attributable to the member who spent it.
    """
    subject = await ensure_organization_billing_subject(db, organization_id)
    enrollment = await agent_gateway_store.ensure_enrollment_row(
        db,
        subject_kind=AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
        billing_subject_id=subject.id,
        organization_id=organization_id,
        user_id=user_id,
    )
    if not settings.agent_gateway_enabled:
        return enrollment
    enrollment = await _reopen_if_key_set_drifted(
        db,
        enrollment,
        subject_label=f"org-{organization_id}-user-{user_id}",
    )
    if enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED:
        return enrollment
    # Org caps (spec section 7): overage-enabled orgs are effectively
    # uncapped ("0" sends no LiteLLM budget) — the top-up worker keeps the
    # ledger funded and the importer remains the reconciler. Otherwise the
    # team budget is the remaining credit (hard cap), falling back to the
    # default org budget when the org holds no grants.
    if subject.overage_enabled:
        budget_raw = "0"
    else:
        budget_raw = await _remaining_credit_budget_raw(
            db,
            billing_subject_id=subject.id,
            fallback=settings.agent_gateway_default_org_budget_usd,
        )
    return await _sync_enrollment(
        db,
        enrollment=enrollment,
        team_alias=f"org-{organization_id}",
        # Per-member attribution (spec §2.3): the member's key is minted under
        # their own LiteLLM user, matching their personal enrollment, so org
        # spend rows stay attributable to the member who spent them.
        litellm_user_id=f"user-{user_id}",
        subject_label=f"org-{organization_id}-user-{user_id}",
        budget_raw=budget_raw,
    )


async def _sync_one_harness_key(
    db: AsyncSession,
    *,
    enrollment: AgentGatewayEnrollmentRecord,
    harness_kind: str,
    team_id: str,
    team_alias: str,
    litellm_user_id: str | None,
    subject_label: str,
) -> None:
    """Mint (or leave alone) the (enrollment, harness) child key, idempotently.

    Skips the mint entirely when an active child key already exists for this
    harness — this is the retry-after-partial-failure path, mirroring the
    pre-B2 single-key behavior of never re-minting a key we already hold.
    """
    existing = await agent_gateway_store.get_active_enrollment_key(
        db,
        enrollment_id=enrollment.id,
        harness_kind=harness_kind,
    )
    if existing is not None and existing.virtual_key_id is not None:
        return
    key_alias = _key_alias(enrollment.id, subject_label, harness_kind)
    metadata = enrollment_key_metadata(enrollment, harness_kind)
    minted = await _mint_virtual_key_idempotent(
        user_id=litellm_user_id or team_alias,
        team_id=team_id,
        alias=key_alias,
        metadata=metadata,
        models=[harness_kind],
    )
    await agent_gateway_store.upsert_enrollment_key(
        db,
        enrollment_id=enrollment.id,
        harness_kind=harness_kind,
        virtual_key_id=minted.token_id or None,
        virtual_key=minted.key,
        sync_fingerprint=build_enrollment_key_fingerprint(
            team_id=team_id,
            key_alias=key_alias,
        ),
    )


async def _revoke_parent_key(enrollment: AgentGatewayEnrollmentRecord) -> None:
    """Delete the pre-B2 unscoped per-subject key this enrollment still owns.

    The B2 migration flips synced enrollments back to ``pending`` so they
    re-sync into per-harness keys, and that sync clears the parent row's key
    material. Clearing the row is not revocation: the key stays live on the
    proxy with all-model access, honoring any client that already holds it,
    and its spend can no longer be attributed to a tracked key (the importer
    files it ``needs_review``, so it is never debited).

    Best-effort: ``delete_virtual_key`` itself tolerates a missing key (the
    key being gone IS the desired end state — e.g. a prior revoke that landed
    on the proxy but whose DB write then rolled back, leaving this same
    ``virtual_key_id`` to retry against a key LiteLLM no longer has), logging
    and returning rather than raising. That tolerance is what keeps the sync
    from wedging the row ``failed`` forever on a retry of an already-completed
    delete. Enrollments minted post-B2 carry no parent key and no-op here.
    """
    if enrollment.virtual_key_id is None:
        return
    logger.info(
        "Reclaiming pre-B2 unscoped gateway key at sync",
        extra={
            "enrollment_id": str(enrollment.id),
            "subject_kind": enrollment.subject_kind,
        },
    )
    await litellm.delete_virtual_key(key_or_token_id=enrollment.virtual_key_id)


async def _sync_enrollment(
    db: AsyncSession,
    *,
    enrollment: AgentGatewayEnrollmentRecord,
    team_alias: str,
    litellm_user_id: str | None,
    subject_label: str,
    budget_raw: str,
) -> AgentGatewayEnrollmentRecord:
    budget = _parse_budget(budget_raw)
    qualification_metadata = _qualification_run_metadata() or None
    try:
        team_id = await litellm.ensure_team(
            alias=team_alias,
            max_budget=budget,
            metadata=qualification_metadata,
        )
        if litellm_user_id is not None:
            await litellm.ensure_user(
                user_id=litellm_user_id,
                metadata=qualification_metadata,
            )
        # Mint (or confirm) exactly one access-group-scoped key per
        # gateway-capable harness — R2: eager minting of all keys at
        # enrollment, never lazy per-selection.
        for harness_kind in _GATEWAY_CAPABLE_HARNESS_KINDS:
            await _sync_one_harness_key(
                db,
                enrollment=enrollment,
                harness_kind=harness_kind,
                team_id=team_id,
                team_alias=team_alias,
                litellm_user_id=litellm_user_id,
                subject_label=subject_label,
            )
        # Reclaim the pre-B2 unscoped key BEFORE the row stops pointing at it:
        # once `mark_enrollment_synced` clears `virtual_key_id` we lose the
        # only handle we have on it. Left alive it would be an all-model key
        # any client that already holds it keeps using, and its spend would
        # land `needs_review` (unresolvable to a tracked key) instead of being
        # debited. `delete_virtual_key` tolerates the delete failing (missing
        # key or transport error alike) rather than raising, so a retry of an
        # already-completed revoke can never wedge the row `failed` forever.
        await _revoke_parent_key(enrollment)
        # The parent enrollment row no longer carries its own key material
        # (post-B2, model-gateway.md §Account model): keys live exclusively on
        # the child table. `virtual_key_id=None, virtual_key=None` clears any
        # pre-B2 single unscoped key still on the row.
        synced = await agent_gateway_store.mark_enrollment_synced(
            db,
            enrollment_id=enrollment.id,
            litellm_team_id=team_id,
            litellm_user_id=litellm_user_id,
            virtual_key_id=None,
            virtual_key=None,
            # Fingerprints the expected *key set* (team + alias subject +
            # gateway-capable harness kinds), which is exactly what
            # `_reopen_if_key_set_drifted` re-computes and compares on the next
            # pass. The old value hashed the budget and mislabeled
            # `subject_label` as a `key_alias`, describing neither the set nor
            # any real alias.
            sync_fingerprint=build_enrollment_key_set_fingerprint(
                team_id=team_id,
                subject_label=subject_label,
                harness_kinds=_GATEWAY_CAPABLE_HARNESS_KINDS,
            ),
        )
        if synced.user_id is not None:
            # A gateway selection may have been waiting on this enrollment;
            # push fresh agent-auth state into the user's live sandbox.
            await materialization_service.schedule_materialize_agent_auth(
                db,
                user_id=synced.user_id,
            )
        return synced
    except LiteLLMIntegrationError as error:
        logger.warning(
            "Agent gateway enrollment sync failed",
            extra={
                "enrollment_id": str(enrollment.id),
                "subject_kind": enrollment.subject_kind,
                "error_code": error.code,
            },
        )
        return await agent_gateway_store.mark_enrollment_failed(
            db,
            enrollment_id=enrollment.id,
            error_code=error.code,
            error_message=error.message,
        )


async def backfill_enrollments(db: AsyncSession, *, limit: int = 50) -> int:
    """Sync pending/failed enrollments and enroll users missing rows.

    Work is bounded to ``limit`` subjects per invocation. Returns the number
    of subjects processed.
    """
    processed = 0
    pending = await agent_gateway_store.list_enrollments_needing_sync(db, limit=limit)
    for enrollment in pending:
        is_user = enrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_USER
        if is_user and enrollment.user_id is not None:
            await ensure_user_enrollment(db, enrollment.user_id)
        elif enrollment.organization_id is not None and enrollment.user_id is not None:
            await ensure_org_enrollment(db, enrollment.organization_id, enrollment.user_id)
        processed += 1

    remaining = limit - processed
    if remaining <= 0:
        return processed
    missing_user_ids = await agent_gateway_store.list_user_ids_missing_enrollment(
        db,
        limit=remaining,
    )
    for user_id in missing_user_ids:
        await ensure_user_enrollment(db, user_id)
        processed += 1

    remaining = limit - processed
    if remaining <= 0:
        return processed
    # Symmetric org recovery: a lost org-join hook leaves an active membership
    # with no enrollment row, which would otherwise never self-heal.
    missing_memberships = await agent_gateway_store.list_org_memberships_missing_enrollment(
        db,
        limit=remaining,
    )
    for organization_id, member_user_id in missing_memberships:
        await ensure_org_enrollment(db, organization_id, member_user_id)
        processed += 1
    return processed
