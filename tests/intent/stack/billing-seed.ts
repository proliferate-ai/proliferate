// Billing harness — direct DB seeding + assertion reads (billing_subject,
// billing_grant, usage_segment, billing_hold, billing_budget_limit,
// agent_llm_usage_event) and the read helpers the specs assert against. Split
// out of billing.ts for the repo-shape line cap.

import { randomUUID } from "node:crypto";

import { withDb } from "./billing-env.ts";

// ── Billing subjects ──

export interface SeededSubject {
  id: string;
  kind: "personal" | "organization";
  stripeCustomerId: string | null;
}

/** Ensure a personal billing subject exists for a user and (optionally) link a
 * Stripe customer id. Mirrors what `ensure_personal_billing_subject` produces;
 * the row has no FK to the user table so a direct upsert is safe. */
export async function ensurePersonalSubject(
  userId: string,
  stripeCustomerId?: string,
): Promise<SeededSubject> {
  return withDb(async (db) => {
    const existing = await db.query(
      `SELECT id, kind, stripe_customer_id FROM billing_subject WHERE user_id = $1`,
      [userId],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (stripeCustomerId && row.stripe_customer_id !== stripeCustomerId) {
        await db.query(`UPDATE billing_subject SET stripe_customer_id = $1 WHERE id = $2`, [
          stripeCustomerId,
          row.id,
        ]);
      }
      return {
        id: row.id,
        kind: row.kind,
        stripeCustomerId: stripeCustomerId ?? row.stripe_customer_id,
      };
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO billing_subject (id, kind, user_id, stripe_customer_id, overage_enabled, overage_cap_cents_per_seat, created_at, updated_at)
       VALUES ($1, 'personal', $2, $3, false, 2000, now(), now())`,
      [id, userId, stripeCustomerId ?? null],
    );
    return { id, kind: "personal", stripeCustomerId: stripeCustomerId ?? null };
  });
}

export async function ensureOrganizationSubject(
  organizationId: string,
  ownerUserId: string,
  stripeCustomerId?: string,
): Promise<SeededSubject> {
  return withDb(async (db) => {
    const existing = await db.query(
      `SELECT id, kind, stripe_customer_id FROM billing_subject WHERE organization_id = $1`,
      [organizationId],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (stripeCustomerId) {
        await db.query(`UPDATE billing_subject SET stripe_customer_id = $1 WHERE id = $2`, [
          stripeCustomerId,
          row.id,
        ]);
      }
      return { id: row.id, kind: row.kind, stripeCustomerId: stripeCustomerId ?? row.stripe_customer_id };
    }
    const id = randomUUID();
    // ck_billing_subject_organization_owner: org subjects carry
    // organization_id only — user_id must be NULL (ownerUserId is used by
    // callers for seeding grants/segments, not stored on the subject).
    await db.query(
      `INSERT INTO billing_subject (id, kind, organization_id, user_id, stripe_customer_id, overage_enabled, overage_cap_cents_per_seat, created_at, updated_at)
       VALUES ($1, 'organization', $2, NULL, $3, false, 2000, now(), now())`,
      [id, organizationId, stripeCustomerId ?? null],
    );
    return { id, kind: "organization", stripeCustomerId: stripeCustomerId ?? null };
  });
}

export async function setOverageSettings(
  subjectId: string,
  opts: { enabled: boolean; capCentsPerSeat?: number },
): Promise<void> {
  await withDb((db) =>
    db.query(
      `UPDATE billing_subject
         SET overage_enabled = $1,
             overage_cap_cents_per_seat = COALESCE($2, overage_cap_cents_per_seat),
             overage_preference_set_at = now(),
             updated_at = now()
       WHERE id = $3`,
      [opts.enabled, opts.capCentsPerSeat ?? null, subjectId],
    ),
  );
}

// ── Per-run reset ──

/** Wipe billing state (grants, subscriptions, holds, segments, exports,
 * receipts, budget limits, LLM events, allocations) so each run's assertions
 * see only its own rows. The t2billing profile DB persists across runs by
 * design (one claim per single-org DB), so without this, grant/adjustment
 * counts accumulate. Accounts/org/memberships are NOT touched — the claimed
 * admin and registered members stay valid; Stripe-side test objects are
 * per-run (Date.now()-suffixed) and expire with their test clocks. */
export async function resetBillingState(): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `TRUNCATE TABLE
         billing_grant_consumption,
         billing_grant,
         billing_seat_adjustment,
         billing_usage_export,
         billing_overage_remainder,
         billing_usage_cursor,
         billing_subscription,
         billing_hold,
         billing_decision_event,
         billing_entitlement,
         billing_budget_limit,
         usage_segment,
         agent_llm_usage_event,
         webhook_event_receipt,
         free_cloud_allocation,
         llm_credit_grant,
         billing_subject
       CASCADE`,
    );
  });
}

// ── Product readiness (GitHub gate) ──

/** Product surfaces (billing, agent-gateway) sit behind the GitHub
 * product-readiness gate (`_require_product_ready` → 403
 * `github_link_required`) — deliberately even in single-org mode (see
 * `current_organization_actor`'s docstring: only org-membership surfaces
 * admit password-only accounts). This boot disables GitHub OAuth, so accounts
 * here are password-only; seed the legacy `oauth_account` GitHub row the
 * readiness check accepts (`_read_valid_legacy_github_account`) — the
 * direct-DB analog of local dev's seeded-GitHub-auth layer
 * (specs/developing/local/feature-worktree-auth.md).
 *
 * Deliberately NOT an `auth_identity` row: free-trial-v2 issuance keys off
 * `auth_identity` (`_linked_github_provider_user_id`), so this unlocks the
 * product gate without lazily issuing free-trial grants that would corrupt
 * the suite's grant math (drain/cut-off assertions), and the "no GitHub
 * identity → no trial" pin in webhooks.spec.ts keeps its meaning. */
export async function ensureProductReady(userId: string, email: string): Promise<void> {
  await withDb((db) =>
    db.query(
      `INSERT INTO oauth_account (id, user_id, oauth_name, access_token, expires_at, refresh_token, account_id, account_email)
       SELECT $1, $2, 'github', 'gho_t2billing_product_ready_stub', NULL, NULL, $3, $4
       WHERE NOT EXISTS (SELECT 1 FROM oauth_account WHERE user_id = $2 AND oauth_name = 'github')`,
      [randomUUID(), userId, `t2billing-${userId}`, email],
    ),
  );
}

// ── Grants ──

export interface SeedGrantOptions {
  userId?: string;
  grantType: string;
  hoursGranted: number;
  remainingSeconds?: number;
  effectiveAt?: Date;
  expiresAt?: Date | null;
  sourceRef?: string;
}

export async function seedGrant(subjectId: string, opts: SeedGrantOptions): Promise<string> {
  const id = randomUUID();
  const remaining = opts.remainingSeconds ?? opts.hoursGranted * 3600;
  // Default effective_at BACKDATED: the accounting pass checks grant
  // usability at the usage range's accounted_from (segment start), not at
  // "now" (grant_is_usable_for_accounting(at=accounted_from)). A grant
  // effective "now" can never cover the backdated segments these specs seed,
  // so default a week back; explicit opts.effectiveAt still wins.
  const effectiveAt = opts.effectiveAt ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
  await withDb((db) =>
    db.query(
      `INSERT INTO billing_grant
         (id, user_id, billing_subject_id, grant_type, hours_granted, remaining_seconds, effective_at, expires_at, source_ref, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
      [
        id,
        opts.userId ?? null,
        subjectId,
        opts.grantType,
        opts.hoursGranted,
        remaining,
        effectiveAt.toISOString(),
        opts.expiresAt === null ? null : (opts.expiresAt ?? null)?.toISOString() ?? null,
        opts.sourceRef ?? `t2billing:${opts.grantType}:${id}`,
      ],
    ),
  );
  return id;
}

export interface GrantRow {
  id: string;
  grant_type: string;
  hours_granted: number;
  remaining_seconds: number;
  effective_at: string;
  expires_at: string | null;
  source_ref: string | null;
}

export async function listGrants(subjectId: string): Promise<GrantRow[]> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT id, grant_type, hours_granted, remaining_seconds, effective_at, expires_at, source_ref
         FROM billing_grant WHERE billing_subject_id = $1 ORDER BY effective_at, expires_at NULLS LAST`,
      [subjectId],
    );
    return result.rows as GrantRow[];
  });
}

export async function totalRemainingSeconds(subjectId: string): Promise<number> {
  const grants = await listGrants(subjectId);
  return grants.reduce((sum, g) => sum + Number(g.remaining_seconds), 0);
}

// ── Usage segments (compute) ──

export interface SeedSegmentOptions {
  userId: string;
  hours: number;
  ended?: boolean;
  startedAt?: Date;
}

export async function seedUsageSegment(subjectId: string, opts: SeedSegmentOptions): Promise<string> {
  const id = randomUUID();
  const ended = opts.ended ?? true;
  const started = opts.startedAt ?? new Date(Date.now() - opts.hours * 3600 * 1000);
  const endedAt = ended ? new Date(started.getTime() + opts.hours * 3600 * 1000) : null;
  await withDb((db) =>
    db.query(
      `INSERT INTO usage_segment
         (id, user_id, billing_subject_id, workspace_id, sandbox_id, external_sandbox_id, started_at, ended_at, is_billable, opened_by, closed_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'provision', $9, now(), now())`,
      [
        id,
        opts.userId,
        subjectId,
        randomUUID(),
        randomUUID(),
        `sandbox-${id.slice(0, 8)}`,
        started.toISOString(),
        endedAt ? endedAt.toISOString() : null,
        ended ? "manual_stop" : null,
      ],
    ),
  );
  return id;
}

// ── Holds ──

export async function listActiveHolds(subjectId: string): Promise<Array<{ kind: string; status: string; source: string }>> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT kind, status, source FROM billing_hold WHERE billing_subject_id = $1 AND status = 'active'`,
      [subjectId],
    );
    return result.rows as Array<{ kind: string; status: string; source: string }>;
  });
}

// ── Budget limits (admin caps) ──

export async function seedBudgetLimit(opts: {
  organizationId: string;
  userId?: string | null;
  kind: "compute" | "llm";
  window: "day" | "month";
  capValue: number;
  enabled?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await withDb((db) =>
    db.query(
      `INSERT INTO billing_budget_limit (id, organization_id, user_id, kind, "window", cap_value, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
      [id, opts.organizationId, opts.userId ?? null, opts.kind, opts.window, opts.capValue, opts.enabled ?? true],
    ),
  );
  return id;
}

export async function setBudgetLimitEnabled(limitId: string, enabled: boolean): Promise<void> {
  await withDb((db) =>
    db.query(`UPDATE billing_budget_limit SET enabled = $1, updated_at = now() WHERE id = $2`, [enabled, limitId]),
  );
}

// ── LLM usage events ──

export async function seedLlmUsageEvent(opts: {
  subjectId?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  costUsd: number;
  promptTokens?: number;
  completionTokens?: number;
  occurredAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  const prompt = opts.promptTokens ?? 100;
  const completion = opts.completionTokens ?? 100;
  await withDb((db) =>
    db.query(
      `INSERT INTO agent_llm_usage_event
         (id, litellm_request_id, user_id, organization_id, billing_subject_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, status, occurred_at, imported_at)
       VALUES ($1, $2, $3, $4, $5, 'anthropic', 'claude-haiku-test', $6, $7, $8, $9, 'imported', $10, now())`,
      [
        id,
        `req_${id}`,
        opts.userId ?? null,
        opts.organizationId ?? null,
        opts.subjectId ?? null,
        prompt,
        completion,
        prompt + completion,
        opts.costUsd,
        (opts.occurredAt ?? new Date()).toISOString(),
      ],
    ),
  );
  return id;
}

// ── Assertion reads ──

export async function countWebhookReceipts(eventType?: string): Promise<number> {
  return withDb(async (db) => {
    const result = eventType
      ? await db.query(`SELECT count(*)::int AS n FROM webhook_event_receipt WHERE event_type = $1`, [eventType])
      : await db.query(`SELECT count(*)::int AS n FROM webhook_event_receipt`);
    return result.rows[0].n as number;
  });
}

export async function listSeatAdjustments(subjectId: string): Promise<
  Array<{ status: string; target_quantity: number; grant_quantity: number }>
> {
  return listSeatAdjustmentsWithRef(subjectId);
}

export async function listSeatAdjustmentsWithRef(subjectId: string): Promise<
  Array<{ status: string; target_quantity: number; grant_quantity: number; source_ref: string }>
> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT status, target_quantity, grant_quantity, source_ref FROM billing_seat_adjustment
         WHERE billing_subject_id = $1 ORDER BY created_at`,
      [subjectId],
    );
    return result.rows as Array<{
      status: string;
      target_quantity: number;
      grant_quantity: number;
      source_ref: string;
    }>;
  });
}

export async function listUsageExports(subjectId: string): Promise<
  Array<{ status: string; meter_quantity_cents: number | null; writeoff_reason: string | null }>
> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT status, meter_quantity_cents, writeoff_reason FROM billing_usage_export
         WHERE billing_subject_id = $1 ORDER BY accounted_from`,
      [subjectId],
    );
    return result.rows as Array<{ status: string; meter_quantity_cents: number | null; writeoff_reason: string | null }>;
  });
}
