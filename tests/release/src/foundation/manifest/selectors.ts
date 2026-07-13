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
import type { CellSpec } from "../runner/plan-builder.js";
import type { ParsedManifest } from "./types.js";

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

/** merge: the complete Tier 2 manifest. Planned rows still resolve as required. */
export function resolveMergeSelection(parsed: ParsedManifest): ResolvedSelection {
  const cells: CellSpec[] = parsed.manifest.requiredScenarios
    .filter((s) => s.tier === 2)
    .map((s) => ({ scenarioId: s.id, world: "tier-2" as WorldId, disposition: "required" as const }));
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
      for (const world of worlds) {
        cells.push({ scenarioId: row.id, world, disposition: "required" });
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
    const world = trigger.world ?? journeyRow?.world;
    if (!world) {
      problems.push(
        `triggered Tier 4 id "${trigger.scenarioId}" is collected/enforced but has no world; ` +
          "supply a world on the trigger (flat Tier 4 rows carry no world in the manifest)",
      );
      continue;
    }
    cells.push({
      scenarioId: trigger.scenarioId,
      world,
      productHost: trigger.productHost ?? null,
      disposition: "required",
    });
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

export function resolveExplicitSelection(
  parsed: ParsedManifest,
  input: ExplicitSelectionInput,
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
      cells.push({ scenarioId: id, world: input.world, productHost: input.productHost ?? null, disposition: "required" });
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
}

export function resolveSelection(
  parsed: ParsedManifest,
  request: SelectionRequest,
): ResolvedSelection {
  switch (request.selector) {
    case "merge":
      return resolveMergeSelection(parsed);
    case "release":
      return resolveReleaseSelection(parsed, { triggeredTier4: request.triggeredTier4 });
    default:
      // "explicit" and any ad hoc label resolve --cells against the manifest.
      return resolveExplicitSelection(parsed, {
        cellIds: request.cellIds,
        world: request.world,
        productHost: request.productHost,
        fixtureNamespaceIds: request.fixtureNamespaceIds,
      });
  }
}
