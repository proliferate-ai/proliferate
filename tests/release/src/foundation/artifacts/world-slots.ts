/**
 * Selected-world artifact-slot completeness.
 *
 * Encodes the World Dependency Matrix
 * (specs/developing/testing/release-worlds-and-fixtures.md#world-dependency-matrix)
 * as which CandidateManifest/RetainedProductionManifest slots each world's
 * "required composition" needs. Given a WorldId set (and, for per-platform
 * slots, the platforms that set actually needs), this verifies every
 * required slot is available before strict execution provisions anything.
 *
 * "Conditional composition" rows (billing cells, native-boundary cells,
 * optional self-host add-ons, ...) are recorded but NOT enforced here by
 * default — they gate a subset of cells, not the whole world, and the
 * concrete cell selection lives with the workstream that owns those cells.
 * A caller that knows it selected the conditional cells can pass
 * `includeConditional: true`.
 */

import type { CandidateManifest, PlatformKey, RetainedProductionManifest, Slot } from "../contracts/artifacts.js";
import type { WorldId } from "../contracts/identity.js";

type ScalarCandidateSlotKey =
  | "serverImage"
  | "webBuild"
  | "desktopApp"
  | "desktopUpdater"
  | "catalogHash"
  | "registryHash"
  | "e2bTemplate"
  | "selfHostBundle"
  | "litellm";

type PerPlatformCandidateSlotKey = "anyharness" | "worker" | "supervisor";

type ScalarRetainedSlotKey =
  | "desktopApp"
  | "desktopUpdater"
  | "desktopUpdaterTrustIdentity"
  | "bundledAnyharnessVersion"
  | "bundledWorkerVersion"
  | "seedHash"
  | "catalogHash"
  | "registryHash"
  | "e2bTemplate"
  | "templateComponents"
  | "installedAgentPins";

export interface CandidateWorldRequirements {
  readonly world: WorldId;
  readonly requiredScalar: readonly ScalarCandidateSlotKey[];
  readonly requiredPerPlatform: readonly PerPlatformCandidateSlotKey[];
  readonly conditionalScalar: readonly ScalarCandidateSlotKey[];
  readonly conditionalPerPlatform: readonly PerPlatformCandidateSlotKey[];
  /** Documents the matrix's "explicitly absent" column; informational only. */
  readonly explicitlyAbsent: readonly string[];
}

export interface RetainedWorldRequirements {
  readonly world: WorldId;
  readonly requiredScalar: readonly ScalarRetainedSlotKey[];
}

// --- Candidate-manifest requirements, one row per World Dependency Matrix line ---

export const CANDIDATE_WORLD_REQUIREMENTS: readonly CandidateWorldRequirements[] = [
  {
    world: "tier-2",
    // Tier 2 boots real server/Postgres/browser hosts directly from source;
    // it does not consume the tier-3/4 candidate-artifact manifest at all.
    requiredScalar: [],
    requiredPerPlatform: [],
    conditionalScalar: [],
    conditionalPerPlatform: [],
    explicitlyAbsent: ["real agent inference", "E2B"],
  },
  {
    world: "local-runtime",
    requiredScalar: ["serverImage", "webBuild", "catalogHash", "registryHash"],
    requiredPerPlatform: ["anyharness"],
    // Stripe test mode has no artifact slot; "packaged Desktop for
    // native-boundary cells" needs desktopApp only when those cells run.
    // LiteLLM gateway is reused standing infra unless the gateway boundary
    // itself changed, so its slot is conditional here too.
    conditionalScalar: ["desktopApp", "litellm"],
    conditionalPerPlatform: [],
    explicitlyAbsent: ["E2B", "self-host EC2"],
  },
  {
    world: "managed-cloud",
    requiredScalar: ["serverImage", "e2bTemplate", "catalogHash", "registryHash", "litellm"],
    requiredPerPlatform: ["anyharness", "worker", "supervisor"],
    conditionalScalar: ["webBuild", "desktopApp"],
    conditionalPerPlatform: [],
    explicitlyAbsent: ["self-host EC2", "the full local harness Cartesian product"],
  },
  {
    world: "self-host",
    requiredScalar: ["selfHostBundle", "serverImage", "catalogHash", "registryHash", "desktopApp"],
    requiredPerPlatform: [],
    // "Operator LiteLLM profile ... or E2B add-on only for their
    // advertised-posture cells" — optional profile, not base composition.
    conditionalScalar: ["litellm", "e2bTemplate"],
    conditionalPerPlatform: [],
    explicitlyAbsent: ["managed-product billing", "unrelated hosted services"],
  },
  {
    world: "desktop-upgrade",
    requiredScalar: ["desktopApp", "desktopUpdater", "catalogHash", "registryHash"],
    requiredPerPlatform: ["anyharness"],
    conditionalScalar: ["serverImage"],
    conditionalPerPlatform: [],
    explicitlyAbsent: ["E2B"],
  },
  {
    world: "managed-cloud-upgrade",
    // The N-1 template/Worker/Supervisor/AnyHarness come from the RETAINED
    // manifest (see RETAINED_WORLD_REQUIREMENTS below); these are the
    // candidate-N artifacts this world additionally needs.
    requiredScalar: ["serverImage", "catalogHash", "registryHash"],
    requiredPerPlatform: ["anyharness", "worker", "supervisor"],
    conditionalScalar: [],
    conditionalPerPlatform: [],
    explicitlyAbsent: ["Desktop application update"],
  },
];

export const RETAINED_WORLD_REQUIREMENTS: readonly RetainedWorldRequirements[] = [
  {
    world: "desktop-upgrade",
    requiredScalar: [
      "desktopApp",
      "desktopUpdater",
      "desktopUpdaterTrustIdentity",
      "bundledAnyharnessVersion",
      "bundledWorkerVersion",
      "seedHash",
      "catalogHash",
      "registryHash",
      "installedAgentPins",
    ],
  },
  {
    world: "managed-cloud-upgrade",
    requiredScalar: ["e2bTemplate", "templateComponents", "catalogHash", "registryHash", "installedAgentPins"],
  },
];

export function candidateRequirementsForWorld(world: WorldId): CandidateWorldRequirements {
  const found = CANDIDATE_WORLD_REQUIREMENTS.find((row) => row.world === world);
  if (!found) {
    throw new Error(`no candidate-slot requirements encoded for world "${world}"`);
  }
  return found;
}

export function retainedRequirementsForWorld(world: WorldId): RetainedWorldRequirements | null {
  return RETAINED_WORLD_REQUIREMENTS.find((row) => row.world === world) ?? null;
}

export interface MissingSlot {
  readonly world: WorldId;
  readonly slot: string;
  readonly platform: PlatformKey | null;
  readonly reason: string;
}

export interface SlotCompletenessReport {
  readonly complete: boolean;
  readonly missing: readonly MissingSlot[];
}

function isAvailable(slot: Slot<unknown> | undefined): boolean {
  return slot !== undefined && slot.available === true;
}

function unavailableReason(slot: Slot<unknown> | undefined): string {
  if (slot === undefined) {
    return "slot is absent from the manifest";
  }
  return slot.available === false ? slot.reason : "slot is available";
}

/**
 * Verifies every slot the given worlds require is available in `manifest`.
 * `platforms` names the platform(s) this run actually needs for per-platform
 * slots (anyharness/worker/supervisor); a required per-platform slot with no
 * platform supplied is reported missing rather than silently skipped.
 */
export function assertCandidateWorldSlotsAvailable(
  worlds: readonly WorldId[],
  manifest: CandidateManifest,
  platforms: readonly PlatformKey[] = [],
  options: { includeConditional?: boolean } = {},
): SlotCompletenessReport {
  const missing: MissingSlot[] = [];

  for (const world of worlds) {
    const requirements = candidateRequirementsForWorld(world);
    const scalarKeys = options.includeConditional
      ? [...requirements.requiredScalar, ...requirements.conditionalScalar]
      : requirements.requiredScalar;
    const perPlatformKeys = options.includeConditional
      ? [...requirements.requiredPerPlatform, ...requirements.conditionalPerPlatform]
      : requirements.requiredPerPlatform;

    for (const key of scalarKeys) {
      const slot = manifest[key] as Slot<unknown> | undefined;
      if (!isAvailable(slot)) {
        missing.push({ world, slot: key, platform: null, reason: unavailableReason(slot) });
      }
    }

    for (const key of perPlatformKeys) {
      if (platforms.length === 0) {
        missing.push({
          world,
          slot: key,
          platform: null,
          reason: "no platform was specified for a required per-platform slot",
        });
        continue;
      }
      const platformMap = manifest[key] as Partial<Record<PlatformKey, Slot<unknown>>>;
      for (const platform of platforms) {
        const slot = platformMap?.[platform];
        if (!isAvailable(slot)) {
          missing.push({ world, slot: key, platform, reason: unavailableReason(slot) });
        }
      }
    }
  }

  return { complete: missing.length === 0, missing };
}

export function assertRetainedWorldSlotsAvailable(
  worlds: readonly WorldId[],
  manifest: RetainedProductionManifest,
): SlotCompletenessReport {
  const missing: MissingSlot[] = [];

  for (const world of worlds) {
    const requirements = retainedRequirementsForWorld(world);
    if (!requirements) {
      continue; // this world has no Tier 4 retained-manifest dependency.
    }
    for (const key of requirements.requiredScalar) {
      const slot = manifest[key] as Slot<unknown> | undefined;
      if (!isAvailable(slot)) {
        missing.push({ world, slot: key, platform: null, reason: unavailableReason(slot) });
      }
    }
  }

  return { complete: missing.length === 0, missing };
}
