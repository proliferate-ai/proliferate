/**
 * Manifest-bound selector resolution.
 *
 * A selector resolves the exact required cell set BEFORE execution, binding the
 * plan to the canonical scenario-manifest hash. The three selectors:
 *
 *  - `merge`    — the trusted Tier 1/2 set: every Tier 2 row (the complete Tier 2
 *                 manifest for the integration commit). A planned row still
 *                 resolves as required, so a missing collector fails closed as a
 *                 missing final rather than silently passing.
 *  - `release`  — standing Tier 3 (journey-referenced + standalone, per the
 *                 manifest's qualificationPolicy) plus change-triggered Tier 4
 *                 rows. Presence is NOT coverage: a `planned` row selected by
 *                 release resolves as DEFERRED, never a silent green. Every
 *                 unreferenced Tier 3 guarantee is a derived deferred entry too.
 *  - `explicit` — ad hoc --cells; every id must EXIST in the manifest (or in a
 *                 declared fixture namespace for tests). An unknown id is a hard
 *                 error; an empty resolution is a hard error before execution.
 *
 * These functions produce `CellSpec[]` for `buildPlan`, plus the derived
 * `deferredScenarioIds` and the real `scenarioManifestHash`.
 */

import type { ProductHost, WorldId } from "../contracts/identity.js";
import { cellKey as computeCellKey } from "../contracts/identity.js";
import type { CellSpec } from "../runner/plan-builder.js";
import type { ParsedManifest } from "./types.js";
import { COLLECTOR_REGISTRY, type CollectorRegistryEntry } from "./registry.js";

/**
 * Expands a selected scenario id to the EXACT executable cell identities its
 * registered collector emits (host + matrix dimensions included). Selection
 * and collection must agree on identity or every required cell reports both
 * "missing final" and "unknown final" at once — the reproduced 69-cells/zero-
 * matches defect. A scenario with no registered collector expands to nothing
 * here; the caller decides whether that is a hard error (collected/enforced)
 * or a bare fail-closed placeholder (planned).
 */
function collectorCellSpecs(
  scenarioId: string,
  registry: readonly CollectorRegistryEntry[],
  requireCore: boolean,
): CellSpec[] {
  const specs: CellSpec[] = [];
  for (const entry of registry) {
    if (entry.scenarioId !== scenarioId) continue;
    // A foundation-partial collector can never satisfy a collected/enforced
    // manifest row: presence is not coverage, and an honest vertical slice
    // (narrower scope or superseded semantics) must not promote the core row.
    if (requireCore && entry.coverage !== "core") continue;
    for (const cell of entry.cells) {
      specs.push({
        scenarioId: cell.scenarioId,
        world: cell.world,
        productHost: cell.productHost,
        dimensions: cell.dimensions,
        disposition: "required",
        // The trusted proof requirement rides with the selected cell: the
        // engine and the aggregate both validate green against it.
        proofRequirement: entry.proofRequirements.get(computeCellKey(cell)) ?? null,
      });
    }
  }
  return specs;
}

/** A selection that could not be resolved against the manifest. */
export class ManifestSelectionError extends Error {
  readonly selector: string;
  readonly problems: readonly string[];

  constructor(selector: string, problems: readonly string[]) {
    super(
      `selector "${selector}" could not resolve against the scenario manifest:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "ManifestSelectionError";
    this.selector = selector;
    this.problems = problems;
  }
}

export interface ResolvedSelection {
  readonly cells: readonly CellSpec[];
  /** Guarantee ids visibly deferred (planned or unreferenced) — never dropped. */
  readonly deferredScenarioIds: readonly string[];
  /** Real canonical hash of the manifest the selection resolved against. */
  readonly scenarioManifestHash: string | null;
}

function isCollectedOrEnforced(status: string): boolean {
  return status === "collected" || status === "enforced";
}

function sortedUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * All distinct worlds a Tier 3 guarantee is composed into by referencing Tier 3
 * journeys. A guarantee referenced from journeys in two worlds expands to a
 * cell per world.
 */
function worldsForTier3Scenario(parsed: ParsedManifest, scenarioId: string): WorldId[] {
  const worlds = new Set<WorldId>();
  for (const journey of parsed.manifest.composedJourneys) {
    if (journey.tier !== 3) continue;
    if (journey.targetScenarioRefs.includes(scenarioId)) worlds.add(journey.world);
  }
  return [...worlds];
}

/**
 * merge: the complete Tier 2 manifest. A collected/enforced row expands to the
 * exact cell identities its registered collector emits; a planned row (no
 * collector yet) resolves as a bare required placeholder that fails closed as
 * a missing final. A collected/enforced row with NO registry entry is a hard
 * wiring error — a coverage claim selection cannot execute.
 */
export function resolveMergeSelection(
  parsed: ParsedManifest,
  registry: readonly CollectorRegistryEntry[] = COLLECTOR_REGISTRY,
): ResolvedSelection {
  const problems: string[] = [];
  const cells: CellSpec[] = [];
  for (const row of parsed.manifest.requiredScenarios) {
    if (row.tier !== 2) continue;
    if (isCollectedOrEnforced(row.implementation.status)) {
      const specs = collectorCellSpecs(row.id, registry, true);
      if (specs.length === 0) {
        const partialOnly = registry.some((e) => e.scenarioId === row.id);
        problems.push(
          partialOnly
            ? `Tier 2 row "${row.id}" claims ${row.implementation.status} but only foundation-partial ` +
              "collectors exist; a partial vertical slice cannot satisfy the core row"
            : `Tier 2 row "${row.id}" claims ${row.implementation.status} but no collector is registered; ` +
              "selection cannot fabricate its cell identity",
        );
        continue;
      }
      cells.push(...specs);
    } else {
      // planned: fail-closed placeholder (missing final under strict).
      cells.push({ scenarioId: row.id, world: "tier-2" as WorldId, disposition: "required" });
    }
  }
  if (problems.length > 0) throw new ManifestSelectionError("merge", problems);
  return { cells, deferredScenarioIds: [], scenarioManifestHash: parsed.hash };
}

/** A change-triggered Tier 4 row to select. World is resolved from the journey
 * when the id is a composed Tier 4 journey; otherwise it must be supplied. */
export interface Tier4Trigger {
  readonly scenarioId: string;
  readonly world?: WorldId;
  readonly productHost?: ProductHost | null;
}

export interface ReleaseSelectionInput {
  /** Change-triggered Tier 4 rows (explicit for now — the change detector is future work). */
  readonly triggeredTier4?: readonly Tier4Trigger[];
}

export function resolveReleaseSelection(
  parsed: ParsedManifest,
  input: ReleaseSelectionInput = {},
  registry: readonly CollectorRegistryEntry[] = COLLECTOR_REGISTRY,
): ResolvedSelection {
  const problems: string[] = [];
  const policy = parsed.manifest.qualificationPolicy.tier3StandingSelection;

  // --- Standing Tier 3 set: journey-referenced + standalone. ---
  const standing = new Set<string>();
  if (policy.includeComposedJourneyReferences) {
    for (const journey of parsed.manifest.composedJourneys) {
      if (journey.tier !== 3) continue;
      for (const ref of journey.targetScenarioRefs) {
        const row = parsed.scenarioById.get(ref);
        if (row && row.tier === 3) standing.add(ref);
      }
    }
  }
  for (const id of policy.standaloneScenarioIds) standing.add(id);

  const cells: CellSpec[] = [];
  const deferred = new Set<string>();

  for (const row of parsed.manifest.requiredScenarios) {
    if (row.tier !== 3) continue;
    const isStanding = standing.has(row.id);
    if (isStanding && isCollectedOrEnforced(row.implementation.status)) {
      const worlds = worldsForTier3Scenario(parsed, row.id);
      if (worlds.length === 0) {
        // Standalone standing guarantee with no journey to place it in a world.
        problems.push(
          `standing Tier 3 guarantee "${row.id}" is collected/enforced but no composed journey ` +
            "places it in a world; a standalone standing guarantee needs a world source",
        );
        continue;
      }
      const specs = collectorCellSpecs(row.id, registry, true);
      if (specs.length > 0) {
        // Exact executable identities from the collector; every emitted cell
        // must sit in a journey-derived world for this guarantee.
        for (const spec of specs) {
          if (!worlds.includes(spec.world)) {
            problems.push(
              `collector for "${row.id}" emits a cell in world "${spec.world}" but its journeys ` +
                `place it in [${worlds.join(", ")}]`,
            );
            continue;
          }
          cells.push(spec);
        }
      } else {
        problems.push(
          `standing Tier 3 guarantee "${row.id}" is ${row.implementation.status} but no collector ` +
            "is registered; selection cannot fabricate its cell identity",
        );
      }
    } else {
      // Unreferenced OR planned-but-standing: visibly deferred, never silent green.
      deferred.add(row.id);
    }
  }

  // --- Change-triggered Tier 4 rows. ---
  for (const trigger of input.triggeredTier4 ?? []) {
    const scenarioRow = parsed.scenarioById.get(trigger.scenarioId);
    const journeyRow = parsed.journeyById.get(trigger.scenarioId);
    if (!scenarioRow && !journeyRow) {
      problems.push(`triggered Tier 4 id "${trigger.scenarioId}" is not in the manifest`);
      continue;
    }
    const tier = scenarioRow?.tier ?? journeyRow?.tier;
    if (tier !== 4) {
      problems.push(`triggered id "${trigger.scenarioId}" is Tier ${tier}, only Tier 4 rows are change-triggered`);
      continue;
    }
    const status = scenarioRow?.implementation.status ?? journeyRow?.implementation.status ?? "planned";
    if (!isCollectedOrEnforced(status)) {
      deferred.add(trigger.scenarioId);
      continue;
    }
    // Collected/enforced: the registered collector owns the exact executable
    // cell identity (host + dimensions). A coverage claim without a collector
    // cannot be selected — selection never fabricates identity.
    const specs = collectorCellSpecs(trigger.scenarioId, registry, true);
    if (specs.length === 0) {
      problems.push(
        `triggered Tier 4 id "${trigger.scenarioId}" is ${status} but no collector is registered; ` +
          "selection cannot fabricate its cell identity",
      );
      continue;
    }
    const expectedWorld = trigger.world ?? journeyRow?.world;
    for (const spec of specs) {
      if (expectedWorld && spec.world !== expectedWorld) {
        problems.push(
          `collector for triggered "${trigger.scenarioId}" emits a cell in world "${spec.world}" ` +
            `but the trigger/journey places it in "${expectedWorld}"`,
        );
        continue;
      }
      cells.push(spec);
    }
  }

  if (problems.length > 0) throw new ManifestSelectionError("release", problems);

  // An empty required resolution can never qualify: during foundation build-out
  // every Tier 3 row is `planned` (deferred) and no Tier 4 change is triggered,
  // so release resolves zero required cells. Refuse to execute a release gate
  // that proves nothing — a hard error BEFORE execution, never a silent pass.
  if (cells.length === 0) {
    throw new ManifestSelectionError("release", [
      "release resolved zero required cells (every standing Tier 3 guarantee is " +
        "deferred and no Tier 4 change was triggered); an empty selection cannot " +
        "qualify and is rejected before execution",
    ]);
  }

  return {
    cells,
    deferredScenarioIds: sortedUnique(deferred),
    scenarioManifestHash: parsed.hash,
  };
}

export interface ExplicitSelectionInput {
  readonly cellIds: readonly string[];
  readonly world: WorldId;
  readonly productHost?: ProductHost | null;
  /** Ids allowed even when absent from the manifest (test fixtures only). */
  readonly fixtureNamespaceIds?: readonly string[];
}

/**
 * explicit: ad hoc --cells for foundation baselines. An id with a REGISTERED
 * collector expands to that collector's exact declared cell identities (host +
 * matrix dimensions) — never a fabricated hostless/dimensionless cell, so the
 * partial billing/LOCAL-2 slices are runnable through the shared CLI. An id in
 * the manifest without any collector resolves as a bare fail-closed
 * placeholder. An unknown id is a hard error. Explicit selection is always a
 * partial baseline; partial collectors run here and only here.
 */
export function resolveExplicitSelection(
  parsed: ParsedManifest,
  input: ExplicitSelectionInput,
  registry: readonly CollectorRegistryEntry[] = COLLECTOR_REGISTRY,
): ResolvedSelection {
  if (input.cellIds.length === 0) {
    throw new ManifestSelectionError("explicit", [
      "no --cells were selected; an empty selection cannot qualify and is rejected before execution",
    ]);
  }
  const fixture = new Set(input.fixtureNamespaceIds ?? []);
  const problems: string[] = [];
  let usedFixture = false;
  const cells: CellSpec[] = [];
  for (const id of input.cellIds) {
    const inManifest = parsed.scenarioById.has(id) || parsed.journeyById.has(id);
    if (inManifest) {
      // Registered collectors (core OR partial) own the exact cell identity.
      const specs = collectorCellSpecs(id, registry, false);
      if (specs.length > 0) {
        cells.push(...specs);
      } else {
        cells.push({ scenarioId: id, world: input.world, productHost: input.productHost ?? null, disposition: "required" });
      }
      continue;
    }
    if (fixture.has(id)) {
      usedFixture = true;
      cells.push({ scenarioId: id, world: input.world, productHost: input.productHost ?? null, disposition: "required" });
      continue;
    }
    problems.push(`unknown scenario id "${id}" — not in the manifest or a declared fixture namespace`);
  }
  if (problems.length > 0) throw new ManifestSelectionError("explicit", problems);

  return {
    cells,
    deferredScenarioIds: [],
    // A pure-manifest explicit selection binds the real hash; a fixture-augmented
    // one is an ad hoc baseline and carries null (always partial per evaluate.ts).
    scenarioManifestHash: usedFixture ? null : parsed.hash,
  };
}

/**
 * One request shape covering every selector, so the runner CLI dispatches on a
 * label without re-implementing the per-selector rules. `merge`/`release`
 * resolve entirely from the manifest and ignore `cellIds`; any other label
 * (default "explicit") resolves `cellIds` against the manifest.
 */
export interface SelectionRequest {
  readonly selector: string;
  readonly cellIds: readonly string[];
  readonly world: WorldId;
  readonly productHost?: ProductHost | null;
  /** Ids allowed even when absent from the manifest (test fixtures only). */
  readonly fixtureNamespaceIds?: readonly string[];
  /** Change-triggered Tier 4 rows for the release selector. */
  readonly triggeredTier4?: readonly Tier4Trigger[];
  /** Collector registry override (tests/world adapters); defaults to the real registry. */
  readonly registry?: readonly CollectorRegistryEntry[];
}

export const KNOWN_SELECTORS = ["merge", "release", "explicit"] as const;

export function resolveSelection(
  parsed: ParsedManifest,
  request: SelectionRequest,
): ResolvedSelection {
  switch (request.selector) {
    case "merge":
      return resolveMergeSelection(parsed, request.registry ?? COLLECTOR_REGISTRY);
    case "release":
      return resolveReleaseSelection(
        parsed,
        { triggeredTier4: request.triggeredTier4 },
        request.registry ?? COLLECTOR_REGISTRY,
      );
    case "explicit":
      return resolveExplicitSelection(
        parsed,
        {
          cellIds: request.cellIds,
          world: request.world,
          productHost: request.productHost,
          fixtureNamespaceIds: request.fixtureNamespaceIds,
        },
        request.registry ?? COLLECTOR_REGISTRY,
      );
    default:
      // An unknown selector name is a hard error, never a silent explicit run.
      throw new ManifestSelectionError(request.selector, [
        `unknown selector "${request.selector}"; known selectors: ${KNOWN_SELECTORS.join(", ")}`,
      ]);
  }
}
