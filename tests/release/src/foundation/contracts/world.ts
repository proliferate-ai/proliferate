/**
 * WorldProvisioner and the discriminated ReadyWorldHandle union.
 *
 * A provisioner returns a typed ready handle only after real readiness has
 * been observed (process/schema health, artifact identity, public
 * reachability where required, controller enrollment, credential
 * applicability). Scenarios receive the handle, never a loose env map.
 * Base handles expose prepared capacity only — they never pre-complete the
 * behavior a scenario is meant to prove.
 */

import type { RunIdentity, ShardIdentity, WorldId } from "./identity.js";
import type { CandidateManifest, RetainedProductionManifest, TemplateSlot } from "./artifacts.js";
import type { CleanupLedger } from "./cleanup.js";
import type { EvidenceSink } from "./evidence.js";

/** One observed readiness fact, recorded into world evidence. */
export interface ReadinessObservation {
  /** e.g. "server-health", "postgres-schema", "template-identity". */
  readonly check: string;
  readonly ok: boolean;
  /** Sanitized observation, e.g. "GET /api/health 200 in 84ms". */
  readonly detail: string;
  readonly observedAt: string;
}

interface ReadyWorldBase {
  readonly run: RunIdentity;
  readonly shard: ShardIdentity;
  readonly readiness: readonly ReadinessObservation[];
}

export interface Tier2WorldHandle extends ReadyWorldBase {
  readonly world: "tier-2";
  /** Sanitized endpoints of the booted stack. */
  readonly serverUrl: string;
  readonly webUrl: string;
  readonly databaseUrl: string;
  readonly stripeTestMode: boolean;
}

export interface LocalRuntimeWorldHandle extends ReadyWorldBase {
  readonly world: "local-runtime";
  readonly serverUrl: string;
  readonly webUrl: string;
  readonly databaseUrl: string;
  readonly anyharnessUrl: string;
  /** Public inference origin of the qualification LiteLLM deployment. */
  readonly gatewayOrigin: string;
  /** Identity of the gateway image/config actually serving this run. */
  readonly gatewayIdentity: string;
}

export interface ManagedCloudWorldHandle extends ReadyWorldBase {
  readonly world: "managed-cloud";
  /** Public candidate API origin. */
  readonly apiUrl: string;
  readonly template: TemplateSlot;
  readonly gatewayOrigin: string;
  /** Names of verified provider capabilities, e.g. ["e2b","github-app","stripe"]. */
  readonly verifiedCapabilities: readonly string[];
}

export interface SelfHostWorldHandle extends ReadyWorldBase {
  readonly world: "self-host";
  /** Reserved capacity only: install and claim are scenario actions. */
  readonly instanceId: string;
  readonly dnsName: string;
  /** Immutable candidate bundle handle to install. */
  readonly bundleLocator: string;
  readonly bundleDigest: string;
  /** Control channel descriptor, e.g. "ssm:<instance>" or "ssh:<host>". */
  readonly control: string;
}

export interface DesktopUpgradeWorldHandle extends ReadyWorldBase {
  readonly world: "desktop-upgrade";
  /** Isolated installation of the retained N-1 app (disposable copy). */
  readonly installedAppPath: string;
  readonly isolatedHome: string;
  /** Isolated updater feed URL; initially advertises nothing newer than N-1. */
  readonly updaterFeedUrl: string;
  readonly retained: RetainedProductionManifest;
}

export interface ManagedCloudUpgradeWorldHandle extends ReadyWorldBase {
  readonly world: "managed-cloud-upgrade";
  readonly apiUrl: string;
  /** Immutable production N-1 template being provisioned. */
  readonly retainedTemplate: TemplateSlot;
  /** Run/target-scoped desired-version channel id — never a global pin. */
  readonly desiredVersionChannel: string;
  /** Immutable candidate-N artifact route prefix. */
  readonly candidateArtifactRoute: string;
  readonly retained: RetainedProductionManifest;
}

export type ReadyWorldHandle =
  | Tier2WorldHandle
  | LocalRuntimeWorldHandle
  | ManagedCloudWorldHandle
  | SelfHostWorldHandle
  | DesktopUpgradeWorldHandle
  | ManagedCloudUpgradeWorldHandle;

export interface WorldContext {
  readonly run: RunIdentity;
  readonly shard: ShardIdentity;
  readonly candidate: CandidateManifest;
  readonly retained: RetainedProductionManifest | null;
  readonly ledger: CleanupLedger;
  readonly evidence: EvidenceSink;
}

/**
 * One per world. `prepare` provisions capacity, registers every external
 * resource in the ledger immediately, observes readiness, and returns the
 * typed handle — or throws a WorldReadinessError. It never returns a handle
 * for an unhealthy or identity-mismatched world.
 */
export interface WorldProvisioner<H extends ReadyWorldHandle = ReadyWorldHandle> {
  readonly world: WorldId;
  prepare(ctx: WorldContext): Promise<H>;
}

export class WorldReadinessError extends Error {
  readonly world: WorldId;
  readonly observations: readonly ReadinessObservation[];

  constructor(world: WorldId, message: string, observations: readonly ReadinessObservation[]) {
    super(message);
    this.name = "WorldReadinessError";
    this.world = world;
    this.observations = observations;
  }
}
