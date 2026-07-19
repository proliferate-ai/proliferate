import { createHash } from "node:crypto";

import type { AuthenticatedActor } from "./authenticated-actor.js";
import { parseLastJsonLine } from "../worlds/managed-cloud/box-seeds.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import { REMOTE_WORKDIR } from "../worlds/managed-cloud/ingress.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

/**
 * `billingThreshold` — the Tier-2 PR-4 "put the actor's balance at a known
 * threshold" concept lifted to REAL managed-cloud actors (spec "New fixture
 * obligations"). The billing/exhaustion journeys (COMPUTE-EXHAUST/-REFILL/
 * -OVERAGE/-RENEW, RECONCILE/CONCURRENCY) need an actor whose remaining balance
 * sits at a deterministic point WITHOUT running real hours or minting real
 * money — the one "permitted acceleration" the contract allows besides the
 * synchronous reconciler.
 *
 * Two ledgers, matching the product's two balances:
 *   - `compute` — the cloud-hours ledger (`billing_grant.remaining_seconds`).
 *     The fixture reduces the actor's ACTIVE compute grant's remaining seconds
 *     to exactly `balance` (a real product row edited in place; the balance is
 *     the number the compute gate reads).
 *   - `llm`     — the managed-LLM credit ledger (`llm_credit_grant.amount_usd`
 *     minus imported usage). The fixture expires prior active credit grants and
 *     writes ONE run-tagged grant summing to imported-spend + the target
 *     remainder, so the observed remaining credit lands at `balance`. It then
 *     rewrites the gateway (LiteLLM) team+key budget to that new total and
 *     unblocks any exhausted key via the product's own
 *     `reactivate_subject_if_credited`, so near-exhaustion journeys see gateway
 *     behavior consistent with the ledger we positioned (`balance` must be > 0
 *     for this path — that primitive no-ops at <= 0).
 *
 * The LLM grant is idempotent on a UNIQUE `source_ref`
 * (`billing-threshold:{run}:{shard}:{userId}:{ledger}`), so a replay never
 * double-adjusts. The side effect runs on the candidate box (it holds the
 * billing DB; there is no public "set my balance" endpoint) through the same
 * injected `serverPython` seam every on-box seed uses, so unit tests exercise
 * the plumbing offline with no real box, DB, or LiteLLM. After positioning, the
 * fixture synchronously awaits the two permitted acceleration levers
 * (`run_billing_accounting_pass` + `run_billing_reconcile_pass`), re-reads the
 * OBSERVED remainder, and ASSERTS it equals the requested balance within a small
 * epsilon — a reduce-only compute path that cannot reach a target above the
 * actor's current credit FAILS loudly rather than silently establishing a
 * different balance.
 *
 * The adjustment registers a `billing_fixture_adjustment` cleanup kind BEFORE it
 * writes (registered-before-create). Its releaser DELETEs the run-tagged grant
 * this fixture created (llm) and RESTORES every grant it mutated in place
 * (compute `remaining_seconds`, llm `expires_at`) to its ORIGINAL value — keyed
 * by grant id, never claiming ownership of a grant it did not create. The
 * restoration receipt is written DURABLY to a 0600 file under the bind-mounted
 * remote workdir, atomically (tmp+fsync+rename), BEFORE the position step commits
 * any mutation; the releaser reads that on-box file directly (never a TS
 * closure), so an interrupted run that died mid-positioning AFTER the commit
 * still restores. A missing receipt (nothing committed) is a clean no-op. The
 * receipt merges FIRST-WRITE-WINS per (table,id,field), so a runner RETRY with
 * the same identity — which sees already-mutated state — never clobbers the true
 * pre-first-call originals.
 *
 * NB (verified against server source, disclosed deviation): the PR-6 design text
 * describes the LLM path as a `BillingGrant(grant_type="qualification_fixture_
 * adjustment")`. On current `main` the LLM credit ledger is a SEPARATE table
 * `llm_credit_grant` (columns `source`/`amount_usd`, a CHECK constraint limiting
 * `source` to free_signup|topup|admin|seat_pool, and a UNIQUE `source_ref`),
 * while `billing_grant` (grant_type/`remaining_seconds`) is the COMPUTE-hours
 * ledger. Writing a `billing_grant` would not move the LLM balance at all. So
 * the LLM path here writes an `llm_credit_grant` with `source="admin"` (the
 * only allowed non-provider source) and the run-tagged unique source_ref; the
 * compute path uses `billing_grant`. This is faithful to the design's INTENT
 * (idempotent run-tagged real grant → observed remainder) against the real
 * schema. Flagged for the integrator.
 */

export type BillingLedger = "llm" | "compute";
export type BillingOwnerScope = "personal" | "organization";

export interface BillingThresholdOptions {
  /** Which balance to position. */
  ledger: BillingLedger;
  /**
   * Target remaining balance after positioning: cloud-hours SECONDS for
   * `compute`, remaining credit USD for `llm`. `0` is a valid exhaustion target.
   */
  balance: number;
  /** Personal (default) or the actor's organization subject. */
  ownerScope?: BillingOwnerScope;
  /**
   * Whether to synchronously run the accounting + reconcile passes after
   * positioning (default true — the permitted acceleration). Set false only to
   * position without forcing convergence (the caller drives the reconciler).
   */
  reconcile?: boolean;
}

export interface BillingThresholdResult {
  /** The billing subject the adjustment landed on (safe id). */
  billingSubjectId: string;
  ledger: BillingLedger;
  /** The run-tag component of the unique source_ref (safe; for evidence/debug). */
  runTag: string;
  /** The OBSERVED remaining balance after positioning + optional reconcile. */
  effectiveRemainder: number;
  /**
   * Present on the `llm` ledger: whether the gateway budget was FULLY reconciled
   * — true ONLY when every eligible active enrollment was re-budgeted
   * (`reconciledEnrollments === eligibleEnrollments`), so a partial/all-failed
   * `reactivate_subject_if_credited` (which swallows per-enrollment
   * LiteLLMIntegrationError and returns a partial count) is observed as false.
   */
  litellmBudgetReconciled?: boolean;
  /** llm only: enrollments `reactivate_subject_if_credited` actually re-budgeted. */
  reconciledEnrollments?: number;
  /** llm only: eligible active enrollments (active, excluding `limit_reached`). */
  eligibleEnrollments?: number;
}

/** One grant row this fixture mutated, with the value needed to restore it on cleanup. */
export interface ModifiedGrant {
  /** `billing_grant` (compute remaining_seconds) or `llm_credit_grant` (expires_at). */
  table: "billing_grant" | "llm_credit_grant";
  /** The grant row id (safe uuid). */
  id: string;
  /** The mutated column. */
  field: "remaining_seconds" | "expires_at";
  /** The ORIGINAL value before the fixture touched it (number seconds, ISO string, or null). */
  original: number | string | null;
}

/**
 * Every side-effecting step, injectable so unit tests run offline. The default
 * `positionLedger` executes the inline Python on the candidate box via
 * `BoxExec.serverPython` (the box-seeds.ts precedent). Secret values never
 * appear here — the balance/target and ids are non-secret.
 */
export interface BillingThresholdTransport {
  positionLedger(box: BoxExec, params: BillingThresholdPositionParams): Promise<BillingThresholdPositionResult>;
}

export interface BillingThresholdPositionParams {
  userId: string;
  /** The actor's organization id — required when ownerScope is "organization". */
  organizationId?: string;
  ledger: BillingLedger;
  ownerScope: BillingOwnerScope;
  balance: number;
  sourceRef: string;
  reconcile: boolean;
  /**
   * Absolute remote path (under the bind-mounted workdir) the position step
   * writes its DURABLE restoration receipt to, atomically, BEFORE it commits any
   * mutation. The cleanup releaser reads exactly this file, so an interrupted run
   * still restores. Deterministic per (run, shard, actor, ledger).
   */
  receiptFile: string;
}

export interface BillingThresholdPositionResult {
  billingSubjectId: string;
  effectiveRemainder: number;
  litellmBudgetReconciled?: boolean;
  reconciledEnrollments?: number;
  eligibleEnrollments?: number;
  /**
   * The grants the position step mutated in place, with their ORIGINAL values.
   * Informational for the caller/evidence; the AUTHORITATIVE restoration source
   * is the durable on-box receipt (see `receiptFile`), which the releaser reads
   * directly — this list is not what cleanup depends on.
   */
  modifiedGrants?: ModifiedGrant[];
}

/**
 * Positions the actor's balance and returns the OBSERVED remainder. Registers
 * the `billing_fixture_adjustment` cleanup (release = expire/delete by
 * source_ref) BEFORE the adjustment runs, so a crash mid-position still tears
 * the planted balance down.
 */
export async function billingThreshold(
  world: ManagedCloudWorld,
  actor: AuthenticatedActor,
  options: BillingThresholdOptions,
  transport: BillingThresholdTransport = defaultBillingThresholdTransport,
): Promise<BillingThresholdResult> {
  if (!world.box) {
    throw new Error(
      "billingThreshold: the managed-cloud world exposes no box-exec seam; positioning a real balance must run " +
        "the product's own billing tables on the candidate box (there is no public 'set my balance' endpoint).",
    );
  }
  if (!Number.isFinite(options.balance) || options.balance < 0) {
    throw new Error(`billingThreshold: balance must be a finite, non-negative number (got ${options.balance}).`);
  }
  // The LLM path calls the product's `reactivate_subject_if_credited` after
  // positioning, which NO-OPS when remaining credit is <= 0. A zero-balance LLM
  // reposition would therefore leave the gateway budget enforcing the OLD total
  // with no re-budget, so it is not a supported target — require BALANCE > 0 for
  // the llm ledger (compute may target 0 for an exhaustion test).
  if (options.ledger === "llm" && options.balance <= 0) {
    throw new Error(
      "billingThreshold: the llm ledger requires balance > 0 (reactivate_subject_if_credited no-ops at <= 0, so a " +
        "zero-credit reposition cannot reconcile the gateway budget). Use the compute ledger for a 0 target.",
    );
  }
  const ownerScope = options.ownerScope ?? "personal";
  const reconcile = options.reconcile ?? true;
  const runTag = `${world.run.run_id}:${world.run.shard_id}`;
  const sourceRef = `billing-threshold:${runTag}:${actor.userId}:${options.ledger}`;
  const box = world.box;

  // Deterministic remote path for the DURABLE restoration receipt: the position
  // step writes it (atomic, 0600) BEFORE it commits any mutation, and the
  // releaser reads exactly this file — never a TS closure — so an interrupted
  // run that died mid-positioning after commit still restores. Slashes in the
  // sourceRef become a filesystem-safe basename.
  const receiptFile = `${REMOTE_WORKDIR}/billing-threshold-receipt-${hashBillingSourceRef(sourceRef)}.json`;

  // Registered-before-create: the releaser reads the durable on-box receipt and
  // DELETEs the run-tagged grant this fixture created (llm path) + RESTORES every
  // grant it mutated in place (compute path) to its ORIGINAL value — never merely
  // expiring someone else's grant. Tolerates an absent receipt (nothing
  // committed → clean no-op). No closure dependency.
  await world.registerCleanup?.("billing_fixture_adjustment", sourceRef, () =>
    releaseBillingFixtureAdjustment(box, receiptFile),
  );

  if (ownerScope === "organization" && !actor.organizationId) {
    throw new Error("billingThreshold: ownerScope 'organization' requires the actor to have an organization id.");
  }
  const positioned = await transport.positionLedger(box, {
    userId: actor.userId,
    organizationId: ownerScope === "organization" ? actor.organizationId : undefined,
    ledger: options.ledger,
    ownerScope,
    balance: options.balance,
    sourceRef,
    reconcile,
    receiptFile,
  });

  // Exact positioning is required (the whole point of the fixture is a KNOWN
  // threshold): a transport that reports a different remainder than requested —
  // e.g. because current credit was below the target and could only be reduced —
  // must FAIL loudly, never silently establish a different balance the journeys
  // would then mis-read. Epsilon absorbs float representation only.
  const epsilon = options.ledger === "llm" ? 1e-6 : 1;
  if (Math.abs(positioned.effectiveRemainder - options.balance) > epsilon) {
    throw new Error(
      `billingThreshold: positioning did not establish the requested ${options.ledger} balance — requested ` +
        `${options.balance}, observed ${positioned.effectiveRemainder}. Exact positioning is required; a lower ` +
        "current balance than the target cannot be raised by the reduce-only compute path (fund the actor first).",
    );
  }

  return {
    billingSubjectId: positioned.billingSubjectId,
    ledger: options.ledger,
    runTag,
    effectiveRemainder: positioned.effectiveRemainder,
    litellmBudgetReconciled: positioned.litellmBudgetReconciled,
    reconciledEnrollments: positioned.reconciledEnrollments,
    eligibleEnrollments: positioned.eligibleEnrollments,
  };
}

/** One-way hash of a source_ref, the only adjustment identity evidence should carry. */
export function hashBillingSourceRef(sourceRef: string): string {
  return createHash("sha256").update(sourceRef).digest("hex");
}

// ---------------------------------------------------------------------------
// Default transport — inline Python on the candidate box
// ---------------------------------------------------------------------------

/**
 * The idempotent, first-write-wins receipt merge, factored out as its own stdlib-
 * only snippet so the positioning script embeds it AND the offline regression can
 * exercise the REAL merge via a local `python3 -c` (no box needed). Writes 0600 +
 * atomic (tmp+fsync+rename). Keeps the earliest original for any (table,id,field)
 * already recorded; appends only genuinely-new entries.
 */
export const RECEIPT_MERGE_HELPER_PY = `import json, os

def merge_receipt(receipt_file, source_ref, modified):
    existing = []
    try:
        with open(receipt_file, "r") as handle:
            existing = (json.load(handle) or {}).get("modified", [])
    except FileNotFoundError:
        existing = []
    by_key = {}
    order = []
    for entry in existing:
        key = (entry["table"], entry["id"], entry["field"])
        if key not in by_key:
            order.append(key)
        by_key[key] = entry
    for entry in modified:
        key = (entry["table"], entry["id"], entry["field"])
        if key not in by_key:
            by_key[key] = entry
            order.append(key)
    merged = [by_key[k] for k in order]
    payload = json.dumps({"source_ref": source_ref, "modified": merged})
    tmp = receipt_file + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, receipt_file)
`;

/**
 * The positioning snippet. Runs the product's OWN store functions against the
 * candidate box's Postgres (never a synthetic INSERT), then the two permitted
 * acceleration passes, and prints the OBSERVED remainder as a single JSON line.
 * Non-secret ids/targets ride via `docker exec -e`; there are no secrets here.
 */
const POSITION_LEDGER_PY = `import asyncio, json, os
from decimal import Decimal
from uuid import UUID
from sqlalchemy import select
from proliferate.db.engine import async_session_factory
from proliferate.db.store.billing_subjects import (
    ensure_personal_billing_subject,
    ensure_organization_billing_subject,
)
from proliferate.db.store.billing import list_grants
from proliferate.db.models.billing import BillingGrant
from proliferate.db.models.cloud.agent_gateway import LlmCreditGrant
from proliferate.db.store.agent_gateway.credits import (
    create_llm_credit_grant,
    get_remaining_credit_usd,
    sum_usage_cost_usd,
)
from proliferate.server.billing.accounting_pass import run_billing_accounting_pass
from proliferate.server.billing.reconciler import run_billing_reconcile_pass
from proliferate.server.billing.snapshot_state import load_snapshot_state_for_subject
from proliferate.server.billing.snapshots import build_billing_snapshot
from proliferate.server.cloud.agent_gateway.topups import reactivate_subject_if_credited
from proliferate.integrations.litellm import LiteLLMIntegrationError
from proliferate.utils.time import utcnow

USER_ID = UUID(os.environ["SEED_USER_ID"])
LEDGER = os.environ["SEED_LEDGER"]
OWNER_SCOPE = os.environ["SEED_OWNER_SCOPE"]
BALANCE = Decimal(os.environ["SEED_BALANCE"])
SOURCE_REF = os.environ["SEED_SOURCE_REF"]
RECEIPT_FILE = os.environ["SEED_RECEIPT_FILE"]
RECONCILE = os.environ.get("SEED_RECONCILE", "1") == "1"


${RECEIPT_MERGE_HELPER_PY}

def _write_receipt(modified):
    # Durable restoration receipt, written 0600 + atomic (tmp+fsync+rename) UNDER
    # the bind-mounted remote workdir BEFORE any mutation commits — so a crash
    # after the commit but before this script returns still leaves the releaser a
    # durable record of what to restore (it reads THIS file, never a TS closure).
    #
    # Idempotent across a runner RETRY with the same run/shard/actor/ledger
    # identity: a second positioning call sees the ALREADY-mutated grant state, so
    # its originals would be the post-first-call values. merge_receipt keeps
    # FIRST-WRITE-WINS per (table,id,field), so retries never clobber the true
    # pre-first-call originals. See RECEIPT_MERGE_HELPER_PY.
    merge_receipt(RECEIPT_FILE, SOURCE_REF, modified)


async def _resolve_subject(db):
    if OWNER_SCOPE == "organization":
        # The actor's org subject; the org id is resolved from the actor's
        # single-org membership by the caller and passed as SEED_ORG_ID.
        return await ensure_organization_billing_subject(db, UUID(os.environ["SEED_ORG_ID"]))
    return await ensure_personal_billing_subject(db, USER_ID)


async def _position_compute(db, subject, modified):
    # Reduce the ACTIVE (unexpired) compute grants' remaining_seconds so the
    # subject's total remaining lands at BALANCE seconds. Editing the real
    # product rows in place — the compute gate reads exactly these.
    grants = [
        g
        for g in await list_grants(db, subject.id)
        if g.expires_at is None or g.expires_at > utcnow()
    ]
    grants.sort(key=lambda g: (g.effective_at, g.created_at))
    total_available = sum(float(g.remaining_seconds) for g in grants)
    target = float(BALANCE)
    # Reduce-only: we can lower remaining_seconds, never raise it. If the actor's
    # current active credit is BELOW the target, exact positioning is impossible
    # here — FAIL loudly rather than establish a different balance.
    if total_available + 1e-6 < target:
        raise SystemExit(
            "billing-threshold compute: current active credit (%.6f s) is below the requested target "
            "(%.6f s); the reduce-only fixture cannot raise it. Fund the actor first." % (total_available, target)
        )
    remaining = target
    for grant in grants:
        take = min(float(grant.remaining_seconds), remaining)
        if take != float(grant.remaining_seconds):
            # Record the ORIGINAL value so cleanup can restore this real grant.
            # NB: we DO NOT touch grant.source_ref — never claim ownership of a
            # grant we did not create; restoration is keyed by grant id.
            modified.append({
                "table": "billing_grant",
                "id": str(grant.id),
                "field": "remaining_seconds",
                "original": float(grant.remaining_seconds),
            })
            grant.remaining_seconds = take
            grant.updated_at = utcnow()
        remaining -= take
    # Durable receipt BEFORE the mutation commits.
    _write_receipt(modified)
    await db.commit()


async def _position_llm(db, subject, modified):
    # Expire prior active credit grants, then write ONE run-tagged grant of
    # (imported spend + target remainder) so remaining_credit == BALANCE. The
    # grant is idempotent on its UNIQUE source_ref. source="admin" is the only
    # allowed non-provider credit source (CHECK constraint).
    now = utcnow()
    active = (
        await db.execute(
            select(LlmCreditGrant).where(
                LlmCreditGrant.billing_subject_id == subject.id,
                LlmCreditGrant.source_ref != SOURCE_REF,
            )
        )
    ).scalars().all()
    for grant in active:
        if grant.expires_at is None or grant.expires_at > now:
            # Record the ORIGINAL expires_at (None or ISO) so cleanup restores it.
            modified.append({
                "table": "llm_credit_grant",
                "id": str(grant.id),
                "field": "expires_at",
                "original": grant.expires_at.isoformat() if grant.expires_at else None,
            })
            grant.expires_at = now
    # Durable receipt BEFORE the FIRST mutation commit (the expiries below AND the
    # created grant are both undone by the releaser: expiries by id-restore from
    # this receipt, the created grant by its deterministic SOURCE_REF).
    _write_receipt(modified)
    await db.commit()
    used = await sum_usage_cost_usd(db, subject.id)
    await create_llm_credit_grant(
        db,
        billing_subject_id=subject.id,
        source="admin",
        amount_usd=(used + BALANCE),
        user_id=USER_ID,
        source_ref=SOURCE_REF,
    )
    await db.commit()


async def _count_eligible_enrollments(db, subject_id):
    # Mirror reactivate_subject_if_credited's OWN eligibility filter: active
    # (non-revoked) enrollments, EXCLUDING limit_reached (an org-cap concern it
    # deliberately skips). This is the denominator the reconciled count must
    # equal for a fully-reconciled gateway budget.
    from proliferate.db.store.agent_gateway.enrollments import (
        list_active_enrollments_for_subject,
    )
    from proliferate.constants.agent_gateway import (
        AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED,
    )
    enrollments = await list_active_enrollments_for_subject(db, billing_subject_id=subject_id)
    return sum(
        1
        for e in enrollments
        if e.budget_status != AGENT_GATEWAY_BUDGET_STATUS_LIMIT_REACHED
    )


async def _observed_remainder(db, subject):
    if LEDGER == "llm":
        balance = await get_remaining_credit_usd(db, subject.id)
        return float(balance.remaining_usd)
    state = await load_snapshot_state_for_subject(db, subject.id)
    snapshot = build_billing_snapshot(state)
    return float(snapshot.remaining_seconds or 0.0)


async def main():
    modified = []
    async with async_session_factory() as db:
        subject = await _resolve_subject(db)
        subject_id = subject.id
        if LEDGER == "llm":
            await _position_llm(db, subject, modified)
        else:
            await _position_compute(db, subject, modified)

    if RECONCILE:
        # The two permitted acceleration levers, run synchronously.
        await run_billing_accounting_pass()
        await run_billing_reconcile_pass()

    # LLM path: after repositioning the credit ledger, the gateway (LiteLLM)
    # team+key budget still enforces the OLD granted total until it is rewritten
    # to the NEW granted total (or uncapped for an overage subject) and any
    # exhausted key is unblocked. The product's own primitive for exactly this
    # is reactivate_subject_if_credited, which returns the COUNT of enrollments
    # it actually re-budgeted (it swallows per-enrollment LiteLLMIntegrationError
    # and can return a partial count). So we compare that count against the
    # number of ELIGIBLE active enrollments and report BOTH; the TS caller marks
    # litellm_budget_reconciled true only when reconciled == eligible. It NO-OPS
    # at remaining <= 0 — the TS caller asserts BALANCE > 0 — and a subject with
    # zero eligible enrollments is a truthful success (0 == 0, nothing to do).
    litellm_budget_reconciled = None
    reconciled_enrollments = None
    eligible_enrollments = None
    if LEDGER == "llm" and RECONCILE:
        try:
            async with async_session_factory() as db:
                eligible_enrollments = await _count_eligible_enrollments(db, subject_id)
                reconciled_enrollments = await reactivate_subject_if_credited(db, subject_id)
                await db.commit()
            litellm_budget_reconciled = reconciled_enrollments == eligible_enrollments
        except LiteLLMIntegrationError:
            litellm_budget_reconciled = False

    async with async_session_factory() as db:
        subject = await _resolve_subject(db)
        remainder = await _observed_remainder(db, subject)
        print(json.dumps({
            "billing_subject_id": str(subject_id),
            "effective_remainder": remainder,
            "litellm_budget_reconciled": litellm_budget_reconciled,
            "reconciled_enrollments": reconciled_enrollments,
            "eligible_enrollments": eligible_enrollments,
            "modified_grants": modified,
        }))


asyncio.run(main())
`;

/**
 * Deletes the run-tagged credit grant this fixture CREATED (llm path) and
 * RESTORES every grant it mutated in place to its captured ORIGINAL value
 * (compute `remaining_seconds`, llm `expires_at`), reading the DURABLE on-box
 * restoration receipt the position step wrote BEFORE it committed — never a
 * TypeScript closure. So an interrupted run that died mid-positioning AFTER the
 * commit still restores from the receipt. Restoration is keyed by grant id (never
 * a source_ref we might not own). Tolerant of a MISSING receipt (nothing was
 * committed → nothing to restore) and of an absent grant. Deletes the receipt
 * file LAST, only after the restore commits.
 */
const RELEASE_ADJUSTMENT_PY = `import asyncio, json, os
from datetime import datetime
from uuid import UUID
from sqlalchemy import delete
from proliferate.db.engine import async_session_factory
from proliferate.db.models.billing import BillingGrant
from proliferate.db.models.cloud.agent_gateway import LlmCreditGrant
from proliferate.utils.time import utcnow

RECEIPT_FILE = os.environ["SEED_RECEIPT_FILE"]


def _load_receipt():
    # A missing receipt means the position step never committed a mutation (it
    # crashed before, or never ran) — a clean no-op, not an error.
    try:
        with open(RECEIPT_FILE, "r") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None


async def main():
    receipt = _load_receipt()
    if receipt is None:
        print(json.dumps({"cleared": True, "restored": 0, "receipt": "absent"}))
        return
    source_ref = receipt["source_ref"]
    modified = receipt.get("modified", [])
    async with async_session_factory() as db:
        # 1. Delete the run-tagged grant this fixture created (llm path only —
        #    the compute path creates no grant). Idempotent, keyed by the
        #    deterministic source_ref recorded in the receipt.
        await db.execute(delete(LlmCreditGrant).where(LlmCreditGrant.source_ref == source_ref))
        # 2. Restore every grant we mutated in place to its ORIGINAL value.
        for row in modified:
            grant_id = UUID(row["id"])
            original = row["original"]
            if row["table"] == "billing_grant":
                grant = await db.get(BillingGrant, grant_id)
                if grant is not None and row["field"] == "remaining_seconds":
                    grant.remaining_seconds = float(original)
                    grant.updated_at = utcnow()
            elif row["table"] == "llm_credit_grant":
                grant = await db.get(LlmCreditGrant, grant_id)
                if grant is not None and row["field"] == "expires_at":
                    grant.expires_at = datetime.fromisoformat(original) if original else None
        await db.commit()
    # Delete the receipt LAST, only after the restore committed.
    try:
        os.remove(RECEIPT_FILE)
    except FileNotFoundError:
        pass
    print(json.dumps({"cleared": True, "restored": len(modified), "receipt": "consumed"}))


asyncio.run(main())
`;

/**
 * The deterministic remote path of the durable restoration receipt for a
 * (run, shard, actor, ledger) identity — the same value `billingThreshold`
 * computes internally. Exported (append-only) so a scenario that wants to
 * invoke the restore-and-reload NOW (not only at world close) can locate the
 * receipt the position step wrote. Mirrors the in-fixture derivation exactly.
 */
export function billingThresholdReceiptFile(runTag: string, userId: string, ledger: BillingLedger): string {
  const sourceRef = `billing-threshold:${runTag}:${userId}:${ledger}`;
  return `${REMOTE_WORKDIR}/billing-threshold-receipt-${hashBillingSourceRef(sourceRef)}.json`;
}

/**
 * Runs the durable restore-and-reload releaser NOW (append-only export of the
 * previously module-private function). Reads the on-box receipt and restores
 * every mutated grant + deletes the run-tagged grant. The still-registered
 * world-close releaser is a clean no-op afterward (a consumed/absent receipt is
 * a no-op — see `RELEASE_ADJUSTMENT_PY`), so calling this early is safe.
 */
export function restoreBillingFixtureAdjustment(box: BoxExec, receiptFile: string): Promise<void> {
  return releaseBillingFixtureAdjustment(box, receiptFile);
}

async function releaseBillingFixtureAdjustment(box: BoxExec, receiptFile: string): Promise<void> {
  const result = await box.serverPython(RELEASE_ADJUSTMENT_PY, {
    env: { SEED_RECEIPT_FILE: receiptFile },
    scriptName: "release-billing-fixture-adjustment.py",
  });
  const parsed = parseLastJsonLine(result.stdout) as { cleared?: unknown };
  if (parsed.cleared !== true) {
    throw new Error(
      `billingThreshold cleanup: the candidate box did not confirm the fixture adjustment was cleared/restored ` +
        `(stdout: ${result.stdout.trim().slice(0, 200)}).`,
    );
  }
}

export const defaultBillingThresholdTransport: BillingThresholdTransport = {
  async positionLedger(box, params) {
    const env: Record<string, string> = {
      SEED_USER_ID: params.userId,
      SEED_LEDGER: params.ledger,
      SEED_OWNER_SCOPE: params.ownerScope,
      SEED_BALANCE: String(params.balance),
      SEED_SOURCE_REF: params.sourceRef,
      SEED_RECEIPT_FILE: params.receiptFile,
      SEED_RECONCILE: params.reconcile ? "1" : "0",
    };
    if (params.organizationId) {
      env.SEED_ORG_ID = params.organizationId;
    }
    const result = await box.serverPython(POSITION_LEDGER_PY, {
      env,
      scriptName: "position-billing-threshold.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as {
      billing_subject_id?: unknown;
      effective_remainder?: unknown;
      litellm_budget_reconciled?: unknown;
      reconciled_enrollments?: unknown;
      eligible_enrollments?: unknown;
      modified_grants?: unknown;
    };
    if (typeof parsed.billing_subject_id !== "string" || typeof parsed.effective_remainder !== "number") {
      throw new Error(
        `billingThreshold: the candidate box did not report a positioned balance ` +
          `(stdout: ${result.stdout.trim().slice(0, 200)}).`,
      );
    }
    return {
      billingSubjectId: parsed.billing_subject_id,
      effectiveRemainder: parsed.effective_remainder,
      litellmBudgetReconciled:
        typeof parsed.litellm_budget_reconciled === "boolean" ? parsed.litellm_budget_reconciled : undefined,
      reconciledEnrollments:
        typeof parsed.reconciled_enrollments === "number" ? parsed.reconciled_enrollments : undefined,
      eligibleEnrollments:
        typeof parsed.eligible_enrollments === "number" ? parsed.eligible_enrollments : undefined,
      modifiedGrants: Array.isArray(parsed.modified_grants)
        ? (parsed.modified_grants as ModifiedGrant[])
        : undefined,
    };
  },
};
