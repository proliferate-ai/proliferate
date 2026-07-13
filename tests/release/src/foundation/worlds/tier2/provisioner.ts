/**
 * Tier2WorldProvisioner: boots the real Tier 2 stack (real server + real
 * Postgres + desktop web build; SINGLE_ORG_MODE, password+claim auth — see
 * tests/intent/stack/boot.ts's own header) and returns a `Tier2WorldHandle`
 * only after real readiness observations, per contracts/world.ts.
 *
 * This reuses `bootStack` from tests/intent/stack/boot.ts (via
 * support/intent-bridge.ts's runtime bridge — see that file's header for why
 * it is not a static import) rather than reimplementing profile/port/DB/
 * process management — that logic already exists and is exercised by the
 * tier-2 intent suite; duplicating it here would drift. What this file adds
 * on top, to satisfy the frozen world contract tests/intent's own harness
 * doesn't need:
 *   - real post-boot readiness observations (server health, Postgres schema,
 *     web reachability) recorded as `ReadinessObservation`s rather than
 *     trusted implicitly because `bootStack()` returned;
 *   - immediate cleanup-ledger registration of the booted process/DB, BEFORE
 *     the handle is used for anything else;
 *   - optional real Stripe test-mode wiring (resolved via
 *     `secret-preflight.ts`) so the one billing cell in this workstream can
 *     run for real against the same handle, matching the target contract's
 *     "Stripe test mode where relevant" Tier 2 world composition.
 */

import { performance } from "node:perf_hooks";
import { Client } from "pg";

import type { WorldContext, WorldProvisioner, ReadinessObservation, Tier2WorldHandle } from "../../contracts/world.js";
import { WorldReadinessError } from "../../contracts/world.js";

import { loadBootModule, type BootedStackLike, type StripeBillingEnvLike } from "./support/intent-bridge.js";
import { toPostgresDriverUrl } from "./support/postgres-url.js";
import { resolveStripeTestSecretKey } from "./secret-preflight.js";
import { provisionStripeTestBillingEnv } from "./support/stripe-price-catalog.js";

/** Never the default port shortcuts — one dedicated profile for this workstream. */
export const DEFAULT_TIER2_PROFILE = "tf-tier2";

export interface Tier2WorldProvisionerOptions {
  /** Dedicated dev profile (never default ports, never `main`). */
  readonly profile?: string;
  /** For cells that only need the server (no browser, no runtime). */
  readonly skipFrontend?: boolean;
}

/**
 * Superset of `Tier2WorldHandle` with the fields this workstream's own cells
 * need (setup token path, raw teardown, resolved Stripe env) that the frozen
 * contract deliberately keeps out of the public handle shape. Structurally
 * assignable to `Tier2WorldHandle`, so `prepare()` still satisfies
 * `WorldProvisioner<Tier2WorldHandle>` exactly.
 */
export interface InternalTier2WorldHandle extends Tier2WorldHandle {
  readonly profile: string;
  readonly setupTokenFile: string;
  readonly anyharnessUrl: string;
  readonly stripe: StripeBillingEnvLike | null;
  readonly cleanupSequence: number;
  readonly stackTeardown: () => Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export class Tier2WorldProvisioner implements WorldProvisioner<Tier2WorldHandle> {
  readonly world = "tier-2" as const;
  private readonly profile: string;
  private readonly skipFrontend: boolean;

  constructor(options: Tier2WorldProvisionerOptions = {}) {
    this.profile = options.profile ?? DEFAULT_TIER2_PROFILE;
    this.skipFrontend = options.skipFrontend ?? false;
  }

  async prepare(ctx: WorldContext): Promise<Tier2WorldHandle> {
    return this.prepareInternal(ctx);
  }

  async prepareInternal(ctx: WorldContext): Promise<InternalTier2WorldHandle> {
    const readiness: ReadinessObservation[] = [];
    const record = (check: string, ok: boolean, detail: string): void => {
      readiness.push({ check, ok, detail, observedAt: new Date().toISOString() });
    };

    const boot = await loadBootModule();
    const stripe = this.resolveAndProvisionStripe(boot.REPO_ROOT, record);

    let stack: BootedStackLike;
    try {
      stack = await boot.bootStack({
        profile: this.profile,
        stripe: stripe ?? undefined,
        skipFrontend: this.skipFrontend,
      });
    } catch (error) {
      throw new WorldReadinessError("tier-2", `Tier2 stack boot failed: ${describeError(error)}`, readiness);
    }

    // Register the booted process/DB in the cleanup ledger IMMEDIATELY, before
    // it is handed to any other operation (release-worlds-and-fixtures.md
    // "Cleanup ledger": "every external resource is appended ... immediately
    // after creation and before it is handed to another operation").
    const cleanupSequence = await ctx.ledger.register({
      runId: ctx.run.runId,
      shardId: ctx.shard.shardId,
      provider: "local-process",
      resourceType: "tier2-dev-stack",
      resourceId: `${this.profile}:${stack.apiBaseUrl}`,
      owningWorld: "tier-2",
    });

    try {
      await this.observeReadiness(stack, record);
    } catch (error) {
      await this.cleanupAfterReadinessFailure(ctx, cleanupSequence, stack);
      throw new WorldReadinessError("tier-2", `Tier2 world failed readiness: ${describeError(error)}`, readiness);
    }

    for (const observation of readiness) {
      await ctx.evidence.append({ kind: "readiness-observation", world: "tier-2", ...observation });
    }

    return {
      world: "tier-2",
      run: ctx.run,
      shard: ctx.shard,
      readiness,
      serverUrl: stack.apiBaseUrl,
      webUrl: stack.webBaseUrl,
      databaseUrl: stack.databaseUrl,
      stripeTestMode: stripe !== null,
      profile: this.profile,
      setupTokenFile: stack.setupTokenFile,
      anyharnessUrl: stack.anyharnessBaseUrl,
      stripe,
      cleanupSequence,
      stackTeardown: stack.teardown,
    };
  }

  private resolveAndProvisionStripe(
    repoRoot: string,
    record: (check: string, ok: boolean, detail: string) => void,
  ): StripeBillingEnvLike | null {
    const resolution = resolveStripeTestSecretKey();
    if (resolution.status !== "satisfied" || !resolution.secretKey) {
      record("stripe-secret-preflight", false, resolution.detail);
      return null;
    }
    record("stripe-secret-preflight", true, resolution.detail);
    try {
      const stripe = provisionStripeTestBillingEnv(resolution.secretKey, repoRoot);
      record("stripe-price-catalog", true, "idempotent Stripe test-mode price/meter catalog provisioned/verified");
      return stripe;
    } catch (error) {
      record("stripe-price-catalog", false, `price catalog provisioning failed: ${describeError(error)}`);
      return null;
    }
  }

  private async cleanupAfterReadinessFailure(ctx: WorldContext, cleanupSequence: number, stack: BootedStackLike): Promise<void> {
    await ctx.ledger.transition(cleanupSequence, "cleaning");
    try {
      await stack.teardown();
      await ctx.ledger.transition(cleanupSequence, "cleaned");
    } catch (teardownError) {
      await ctx.ledger.transition(cleanupSequence, "failed", describeError(teardownError));
    }
  }

  private async observeReadiness(
    stack: BootedStackLike,
    record: (check: string, ok: boolean, detail: string) => void,
  ): Promise<void> {
    const healthStart = performance.now();
    const health = await fetch(`${stack.apiBaseUrl}/health`);
    const healthMs = Math.round(performance.now() - healthStart);
    record("server-health", health.ok, `GET /health -> ${health.status} in ${healthMs}ms`);
    if (!health.ok) {
      throw new Error(`server health check failed: HTTP ${health.status}`);
    }

    const client = new Client({ connectionString: toPostgresDriverUrl(stack.databaseUrl) });
    await client.connect();
    let schemaPresent = false;
    try {
      const result = await client.query<{ present: boolean }>(
        `SELECT to_regclass('public.organization') IS NOT NULL AS present`,
      );
      schemaPresent = Boolean(result.rows[0]?.present);
    } finally {
      await client.end();
    }
    record(
      "postgres-schema",
      schemaPresent,
      schemaPresent ? "organization table present (alembic head applied)" : "organization table missing",
    );
    if (!schemaPresent) {
      throw new Error("postgres schema check failed: organization table missing");
    }

    if (!this.skipFrontend) {
      const webStart = performance.now();
      const web = await fetch(stack.webBaseUrl);
      const webMs = Math.round(performance.now() - webStart);
      // A 404 still proves the dev server is up and routing (matches
      // bootStack's own waitForHttpOk convention for Vite's cold-compile 404).
      const ok = web.ok || web.status === 404;
      record("web-reachable", ok, `GET ${stack.webBaseUrl} -> ${web.status} in ${webMs}ms`);
      if (!ok) {
        throw new Error(`web reachability check failed: HTTP ${web.status}`);
      }
    }
  }
}
