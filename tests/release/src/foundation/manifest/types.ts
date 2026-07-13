/**
 * Typed model of core-release-scenario-manifest.json.
 *
 * The manifest is the authoritative target inventory: a flat list of guarantee
 * rows (`requiredScenarios`) plus composed world journeys that reference those
 * guarantees. A row's `implementation.status` is a claim about coverage, never
 * coverage itself — a `planned` row has no collector and can never be silently
 * green (see selectors.ts).
 *
 * The schema is validated before any hash is computed (load.ts); these types
 * describe the shape only after successful validation.
 */

import type { ProductHost, WorldId } from "../contracts/identity.js";

/** Coverage claim. Only `collected`/`enforced` rows may carry a real collector. */
export type ImplementationStatus = "planned" | "collected" | "enforced";

/** The manifest's tier axis. Tier 1 is compile/unit and out of this manifest. */
export type ManifestTier = 2 | 3 | 4;

/**
 * Journey host tokens are a coarser vocabulary than the product `ProductHost`
 * enum: a journey may declare `host-neutral` or `cross-host`, which are not
 * single product surfaces.
 */
export type JourneyHost = ProductHost | "host-neutral" | "cross-host";

export const JOURNEY_HOSTS: readonly JourneyHost[] = [
  "desktop-web",
  "desktop-native",
  "hosted-web",
  "host-neutral",
  "cross-host",
];

export interface ManifestImplementation {
  readonly status: ImplementationStatus;
}

/** One guarantee row from `requiredScenarios`. */
export interface ManifestScenarioRow {
  readonly id: string;
  readonly tier: ManifestTier;
  readonly implementation: ManifestImplementation;
}

/** One composed world journey from `composedJourneys`. */
export interface ComposedJourneyRow {
  readonly id: string;
  readonly tier: ManifestTier;
  readonly world: WorldId;
  readonly requiredHosts: readonly JourneyHost[];
  readonly targetScenarioRefs: readonly string[];
  readonly implementation: ManifestImplementation;
}

export interface Tier3StandingSelection {
  readonly includeComposedJourneyReferences: boolean;
  readonly standaloneScenarioIds: readonly string[];
  readonly unreferencedDisposition: "deferred";
  readonly fullCoreQualificationRequiresNoDeferred: boolean;
}

export interface QualificationPolicy {
  readonly tier3StandingSelection: Tier3StandingSelection;
}

export interface CoreReleaseManifest {
  readonly schemaVersion: number;
  readonly qualificationPolicy: QualificationPolicy;
  readonly requiredScenarios: readonly ManifestScenarioRow[];
  readonly composedJourneys: readonly ComposedJourneyRow[];
}

/**
 * A validated manifest plus its canonical hash and id indexes. The hash is the
 * canonical hash of the RAW parsed object (all keys, unmodified), so it is a
 * stable identity for the exact file the selector resolved against.
 */
export interface ParsedManifest {
  readonly manifest: CoreReleaseManifest;
  /** Canonical sha256 of the raw manifest object (contracts/hashing.ts). */
  readonly hash: string;
  readonly scenarioById: ReadonlyMap<string, ManifestScenarioRow>;
  readonly journeyById: ReadonlyMap<string, ComposedJourneyRow>;
}
