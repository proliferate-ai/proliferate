/**
 * Fake WorldProvisioner family for engine tests.
 *
 * Every fake counts its `prepare` calls so a test can assert ZERO provider
 * mutation on the strict-blocked-preflight and dry-run paths. Fakes can be
 * configured to register a run-scoped resource in the cleanup ledger BEFORE
 * returning the handle (proving cleanup registration precedes resource use), to
 * throw a WorldReadinessError, or to return an identity-mismatched / incomplete
 * handle so the runner's readiness guard can be exercised.
 */

import type { RunIdentity, ShardIdentity, WorldId } from "../contracts/identity.js";
import type { RetainedProductionManifest } from "../contracts/artifacts.js";
import type {
  ReadinessObservation,
  ReadyWorldHandle,
  Tier2WorldHandle,
  WorldContext,
  WorldProvisioner,
} from "../contracts/world.js";
import { WorldReadinessError } from "../contracts/world.js";
import { CleanupRunner, ResourceAlreadyAbsentError } from "../ledger/reconcile.js";

export interface FakeProvisionerOptions {
  /** Register a run-scoped resource before returning the handle. */
  registerResource?: { provider: string; resourceType: string; resourceId: string };
  /** Throw a readiness error instead of returning a handle. */
  failReadiness?: string;
  /** Return a handle whose run identity does not match (identity-mismatch guard). */
  mismatchRun?: boolean;
  /** Return a handle with a failing readiness observation (incomplete guard). */
  incompleteReadiness?: boolean;
  /** Whether the registered resource's destructor throws (cleanup failure). */
  cleanupThrows?: boolean;
  /** Whether the registered resource is already absent (idempotent cleanup). */
  cleanupAbsent?: boolean;
  /** Records the order in which resources are actually "used" after registration. */
  useLog?: string[];
}

/**
 * A Tier-2 fake provisioner. Tier 2 is a world like any other; using it keeps
 * the fake minimal while still returning a real discriminated handle.
 */
export class FakeTier2Provisioner implements WorldProvisioner<Tier2WorldHandle> {
  readonly world: WorldId = "tier-2";
  prepareCalls = 0;

  constructor(private readonly options: FakeProvisionerOptions = {}) {}

  async prepare(ctx: WorldContext): Promise<Tier2WorldHandle> {
    this.prepareCalls += 1;
    const opts = this.options;

    if (opts.registerResource) {
      const runner = ctx.ledger as CleanupRunner;
      const { provider, resourceType, resourceId } = opts.registerResource;
      // Register BEFORE first use — the durable write must land before the
      // resource is handed to any other operation.
      await runner.registerResource(
        { runId: ctx.run.runId, shardId: ctx.shard.shardId, provider, resourceType, resourceId, owningWorld: this.world },
        async () => {
          if (opts.cleanupAbsent) throw new ResourceAlreadyAbsentError();
          if (opts.cleanupThrows) throw new Error(`destructor failed for ${resourceId}`);
        },
      );
      opts.useLog?.push(`use:${resourceId}`);
    }

    if (opts.failReadiness) {
      throw new WorldReadinessError(this.world, opts.failReadiness, [
        obs("server-health", false, "GET /api/health 503"),
      ]);
    }

    const readiness: ReadinessObservation[] = opts.incompleteReadiness
      ? [obs("server-health", false, "GET /api/health 503")]
      : [obs("server-health", true, "GET /api/health 200 in 42ms"), obs("postgres-schema", true, "at head")];

    return {
      world: "tier-2",
      run: opts.mismatchRun ? mismatchRun(ctx.run) : ctx.run,
      shard: ctx.shard,
      readiness,
      serverUrl: "https://server.test.invalid",
      webUrl: "https://web.test.invalid",
      databaseUrl: "postgres://db.test.invalid/app",
      stripeTestMode: true,
    };
  }
}

/** Minimal generic fake for other worlds; returns a healthy handle of that world. */
export function fakeProvisioner(world: WorldId): WorldProvisioner {
  return {
    world,
    async prepare(ctx: WorldContext): Promise<ReadyWorldHandle> {
      return healthyHandle(world, ctx.run, ctx.shard);
    },
  };
}

function healthyHandle(world: WorldId, run: RunIdentity, shard: ShardIdentity): ReadyWorldHandle {
  const readiness = [obs("ready", true, "ok")];
  switch (world) {
    case "tier-2":
      return {
        world,
        run,
        shard,
        readiness,
        serverUrl: "https://s.invalid",
        webUrl: "https://w.invalid",
        databaseUrl: "postgres://d.invalid/a",
        stripeTestMode: true,
      };
    case "local-runtime":
      return {
        world,
        run,
        shard,
        readiness,
        serverUrl: "https://s.invalid",
        webUrl: "https://w.invalid",
        databaseUrl: "postgres://d.invalid/a",
        anyharnessUrl: "http://127.0.0.1:8457",
        gatewayOrigin: "https://gw.invalid",
        gatewayIdentity: "litellm@sha256:deadbeef",
      };
    case "managed-cloud":
      return {
        world,
        run,
        shard,
        readiness,
        apiUrl: "https://api.invalid",
        template: { templateId: "tmpl_x", inputHash: "c".repeat(64) },
        gatewayOrigin: "https://gw.invalid",
        verifiedCapabilities: ["e2b", "github-app"],
      };
    case "self-host":
      return {
        world,
        run,
        shard,
        readiness,
        instanceId: "i-0abc",
        dnsName: "run.selfhost.invalid",
        bundleLocator: "s3://selfhost/bundle.tar.gz",
        bundleDigest: "d".repeat(64),
        control: "ssm:i-0abc",
      };
    case "desktop-upgrade":
      return {
        world,
        run,
        shard,
        readiness,
        installedAppPath: "/tmp/run/Proliferate.app",
        isolatedHome: "/tmp/run/home",
        updaterFeedUrl: "http://127.0.0.1:9000/feed.json",
        retained: retainedStub(),
      };
    case "managed-cloud-upgrade":
      return {
        world,
        run,
        shard,
        readiness,
        apiUrl: "https://api.invalid",
        retainedTemplate: { templateId: "tmpl_n1", inputHash: "e".repeat(64) },
        desiredVersionChannel: `channel-${run.runId}`,
        candidateArtifactRoute: `qualification/${run.runId}/candidate`,
        retained: retainedStub(),
      };
    default: {
      const exhaustive: never = world;
      throw new Error(`no fake handle for world ${String(exhaustive)}`);
    }
  }
}

function retainedStub(): RetainedProductionManifest {
  return {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: "f".repeat(40),
    productVersion: "0.2.15",
    qualificationEvidenceRef: "s3://evidence/0.2.15.json",
    desktopApp: { available: false, reason: "stub" },
    desktopUpdater: { available: false, reason: "stub" },
    desktopUpdaterTrustIdentity: { available: false, reason: "stub" },
    bundledAnyharnessVersion: { available: false, reason: "stub" },
    bundledWorkerVersion: { available: false, reason: "stub" },
    seedHash: { available: false, reason: "stub" },
    catalogHash: { available: false, reason: "stub" },
    registryHash: { available: false, reason: "stub" },
    e2bTemplate: { available: false, reason: "stub" },
    templateComponents: { available: false, reason: "stub" },
    installedAgentPins: { available: false, reason: "stub" },
  };
}

function mismatchRun(run: RunIdentity): RunIdentity {
  return { ...run, runId: `${run.runId}-WRONG` };
}

function obs(check: string, ok: boolean, detail: string): ReadinessObservation {
  return { check, ok, detail, observedAt: "2026-07-13T00:00:00.000Z" };
}
