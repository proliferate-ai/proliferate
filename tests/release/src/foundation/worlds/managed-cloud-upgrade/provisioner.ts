/**
 * ManagedCloudUpgradeWorldProvisioner — the base-world capacity for
 * T4-RUNTIME-1 (specs/developing/testing/release-worlds-and-fixtures.md
 * "Managed-cloud upgrade").
 *
 * It prepares only capacity; it never pre-completes the behavior the scenario
 * proves (sandbox provisioning, the baseline turn, and the version flip are
 * scenario actions). It returns a typed ManagedCloudUpgradeWorldHandle ONLY
 * after observing:
 *   - a reachable, FIXED candidate qualification API (held for the whole run);
 *   - a valid retained-production manifest exposing an immutable N-1 E2B
 *     template (never a rolling tag, never a patch-decrement);
 *   - an immutable candidate-N AnyHarness artifact slot with a digest; and
 *   - a run/target-scoped desired-version channel (never a global pin).
 * Otherwise it throws WorldReadinessError with the observations — it never
 * returns a handle for an unhealthy or identity-mismatched world, and never
 * fakes green.
 */

import type { WorldContext, WorldProvisioner, ManagedCloudUpgradeWorldHandle, ReadinessObservation } from "../../contracts/world.js";
import { WorldReadinessError } from "../../contracts/world.js";
import type { WorldId } from "../../contracts/identity.js";
import type { ArtifactLocator, Slot } from "../../contracts/artifacts.js";

import { validateRetainedManifest, requireRetainedTemplate, RetainedManifestError } from "./retained-manifest.js";
import { candidateArtifactRoutePrefix, componentArtifactRoute } from "./artifact-route.js";
import { desiredVersionChannelId } from "./desired-version-channel.js";

/** Result of one reachability probe; injectable so unit tests are deterministic. */
export interface ProbeResult {
  readonly ok: boolean;
  readonly status: number;
  /** Sanitized, e.g. "GET /meta 200 in 84ms". Never a body/secret. */
  readonly detail: string;
}

export type HttpProbe = (url: string) => Promise<ProbeResult>;

export interface ManagedCloudUpgradeProvisionerOptions {
  /** FIXED candidate qualification API origin (+ any api prefix), held for the whole scenario. */
  readonly apiUrl: string;
  /** Injectable HTTP probe; defaults to a real fetch of the meta/health endpoint. */
  readonly probe?: HttpProbe;
}

const LINUX = "linux-x86_64" as const;

async function fetchProbe(url: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET" });
    return {
      ok: response.ok,
      status: response.status,
      detail: `GET ${url} ${response.status} in ${Date.now() - started}ms`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: `GET ${url} failed in ${Date.now() - started}ms: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export class ManagedCloudUpgradeWorldProvisioner
  implements WorldProvisioner<ManagedCloudUpgradeWorldHandle>
{
  readonly world: WorldId = "managed-cloud-upgrade";
  private readonly apiUrl: string;
  private readonly probe: HttpProbe;

  constructor(options: ManagedCloudUpgradeProvisionerOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.probe = options.probe ?? fetchProbe;
  }

  async prepare(ctx: WorldContext): Promise<ManagedCloudUpgradeWorldHandle> {
    const observations: ReadinessObservation[] = [];
    const now = (): string => new Date().toISOString();

    // 1. Retained N-1 manifest must be present and valid. This world is
    //    meaningless without the exact immutable production template.
    if (ctx.retained === null) {
      throw new WorldReadinessError(
        this.world,
        "no retained-production manifest supplied; T4-RUNTIME-1 cannot infer N-1 by patch decrement or rebuild",
        observations,
      );
    }
    try {
      validateRetainedManifest(ctx.retained);
    } catch (error) {
      if (error instanceof RetainedManifestError) {
        observations.push({ check: "retained-manifest", ok: false, detail: error.message, observedAt: now() });
        throw new WorldReadinessError(this.world, error.message, observations);
      }
      throw error;
    }
    const template = requireRetainedTemplate(ctx.retained);
    observations.push({
      check: "retained-template-identity",
      ok: true,
      detail: `immutable N-1 template ${template.templateId} (inputHash ${template.inputHash.slice(0, 12)}…)`,
      observedAt: now(),
    });

    // 2. Candidate-N Linux AnyHarness artifact must be an available immutable
    //    slot with a digest — the artifact the run-scoped route will serve.
    const anyharnessSlot: Slot<ArtifactLocator> | undefined = ctx.candidate.anyharness[LINUX];
    if (anyharnessSlot === undefined || !anyharnessSlot.available) {
      const reason =
        anyharnessSlot === undefined
          ? `candidate manifest has no ${LINUX} AnyHarness slot`
          : `candidate ${LINUX} AnyHarness slot unavailable: ${anyharnessSlot.reason}`;
      observations.push({ check: "candidate-anyharness-slot", ok: false, detail: reason, observedAt: now() });
      throw new WorldReadinessError(this.world, reason, observations);
    }
    const routePrefix = candidateArtifactRoutePrefix(ctx.run.runId, ctx.candidate.sourceSha);
    const anyharnessRoute = componentArtifactRoute(routePrefix, LINUX, "anyharness");
    observations.push({
      check: "candidate-artifact-route",
      ok: true,
      detail: `immutable candidate-N route ${anyharnessRoute.binary} (digest ${anyharnessSlot.value.digest.slice(0, 12)}…, checksum ${anyharnessRoute.checksum})`,
      observedAt: now(),
    });

    // 3. The FIXED candidate qualification API must be reachable. This is the
    //    one API held for the whole scenario; scenarios never re-point it.
    const metaProbe = await this.probe(`${this.apiUrl}/meta`);
    observations.push({ check: "candidate-api-meta", ok: metaProbe.ok, detail: metaProbe.detail, observedAt: now() });
    if (!metaProbe.ok) {
      throw new WorldReadinessError(
        this.world,
        `candidate qualification API not reachable at ${this.apiUrl}/meta (${metaProbe.detail})`,
        observations,
      );
    }

    // 4. Register the run-scoped desired-version channel controller in the
    //    cleanup ledger BEFORE it is used, so any per-target override written by
    //    the scenario is cleared on teardown. The concrete per-target channel id
    //    is derived once the scenario provisions its sandbox.
    const channelController = desiredVersionChannelId(ctx.run.runId, "controller");
    await ctx.ledger.register({
      runId: ctx.run.runId,
      shardId: ctx.shard.shardId,
      provider: "server",
      resourceType: "desired-version-channel",
      resourceId: channelController,
      owningWorld: this.world,
    });
    observations.push({
      check: "desired-version-channel",
      ok: true,
      detail: `run-scoped target desired-version channel ${channelController} (never a global pin)`,
      observedAt: now(),
    });

    await ctx.evidence.append({
      kind: "world-ready",
      world: this.world,
      apiUrl: this.apiUrl,
      retainedTemplate: template.templateId,
      candidateArtifactRoute: routePrefix,
      readiness: observations,
    });

    return {
      world: "managed-cloud-upgrade",
      run: ctx.run,
      shard: ctx.shard,
      readiness: observations,
      apiUrl: this.apiUrl,
      retainedTemplate: template,
      desiredVersionChannel: channelController,
      candidateArtifactRoute: routePrefix,
      retained: ctx.retained,
    };
  }
}
