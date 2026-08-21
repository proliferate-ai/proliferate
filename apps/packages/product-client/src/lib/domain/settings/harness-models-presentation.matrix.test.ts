import { describe, expect, it } from "vitest";
import {
  resolveAllModelsPresentation,
  type AllModelsPresentationInput,
  type HarnessModelsQueryFacts,
} from "./harness-models-presentation";
import { resolveAgentLaunchOptionsRefetchInterval } from "@anyharness/sdk-react";

// The clock is pinned: `freshnessAgo` is already a formatted string on the
// resolver's input, so no cell in this matrix reads a clock at all.
const AGO = ["2m ago", null] as const;

type Q = HarnessModelsQueryFacts & { label: string };
const QUERIES: Q[] = [
  { label: "disabled", isError: false, errorCode: null, serverAnswered: false, isPending: true, fetchStatus: "idle" },
  { label: "fetching", isError: false, errorCode: null, serverAnswered: false, isPending: true, fetchStatus: "fetching" },
  { label: "paused", isError: false, errorCode: null, serverAnswered: false, isPending: true, fetchStatus: "paused" },
  { label: "settled", isError: false, errorCode: null, serverAnswered: false, isPending: false, fetchStatus: "idle" },
  { label: "err/answered", isError: true, errorCode: null, serverAnswered: true, isPending: false, fetchStatus: "idle" },
  { label: "err/silent", isError: true, errorCode: null, serverAnswered: false, isPending: false, fetchStatus: "idle" },
  { label: "err/not_observed", isError: true, errorCode: "harness_launch_options_not_observed", serverAnswered: true, isPending: false, fetchStatus: "idle" },
  { label: "err/sandbox_404", isError: true, errorCode: "cloud_sandbox_not_found", serverAnswered: true, isPending: false, fetchStatus: "idle" },
];
// query-core cannot report `isPaused` without `isPending`, so only three of
// the four mutation combinations exist.
const MUTATIONS = [
  { label: "idle", isRefreshMutationPending: false, isRefreshMutationPaused: false },
  { label: "running", isRefreshMutationPending: true, isRefreshMutationPaused: false },
  { label: "parked", isRefreshMutationPending: true, isRefreshMutationPaused: true },
];
const CONNECTIONS = ["connecting", "healthy", "failed"] as const;
const WIRE_STATES = ["observed", "observed_empty", "refreshing", "detecting", "last_good_after_failure", "failed_without_observation"] as const;
const PHASES = ["idle", "queued", "running", undefined] as const;

function payload(state: string, probePhase: string | undefined, modelCount: number) {
  return {
    harnessKind: "claude", basisRevision: "b1", revision: 1, state,
    options: {
      models: Array.from({ length: modelCount }, (_u, i) => ({ id: `m-${i}`, observedName: `M${i}`, observedDescription: null })),
      controls: [], defaults: { modelId: null, controlValues: {} },
    },
    observedAt: "2026-08-21T11:58:00Z", probeAttemptedAt: "2026-08-21T11:58:00Z",
    probeFailureCode: null, readiness: "ready", probePhase,
  } as unknown as AllModelsPresentationInput["launchOptions"];
}

function base(o: Partial<AllModelsPresentationInput>): AllModelsPresentationInput {
  return {
    surface: "local", displayName: "Claude", connectionState: "healthy", hasLocalRuntimeHost: true,
    runtimeQuery: QUERIES[3], sandboxQuery: QUERIES[3], hasCloudSandboxId: false,
    cloudLaunchOptionsQuery: QUERIES[3], launchOptions: undefined,
    isRefreshMutationPending: false, isRefreshMutationPaused: false,
    modelCount: 0, freshnessAgo: null, ...o,
  };
}

const payloadCells: AllModelsPresentationInput[] = [];
for (const surface of ["local", "cloud"] as const)
  for (const state of WIRE_STATES) for (const probePhase of PHASES)
    for (const modelCount of [0, 1]) for (const freshnessAgo of AGO)
      for (const m of MUTATIONS)
        payloadCells.push(base({
          surface, launchOptions: payload(state, probePhase, modelCount), modelCount, freshnessAgo,
          runtimeQuery: QUERIES[3], cloudLaunchOptionsQuery: QUERIES[3], hasCloudSandboxId: true, ...m,
        }));

const localAbsentCells: AllModelsPresentationInput[] = [];
for (const hasLocalRuntimeHost of [true, false])
  for (const connectionState of CONNECTIONS) for (const q of QUERIES) for (const m of MUTATIONS)
    localAbsentCells.push(base({ hasLocalRuntimeHost, connectionState, runtimeQuery: q, ...m }));

const cloudAbsentCells: AllModelsPresentationInput[] = [];
for (const sandboxQuery of QUERIES) for (const hasCloudSandboxId of [true, false])
  for (const cloudLaunchOptionsQuery of QUERIES)
    cloudAbsentCells.push(base({ surface: "cloud", sandboxQuery, hasCloudSandboxId, cloudLaunchOptionsQuery }));

const ALL = [...payloadCells, ...localAbsentCells, ...cloudAbsentCells];

/**
 * The whole reachable input space, checked against the invariants the resolver
 * claims — not a hand-picked list of interesting cells.
 *
 * A previous round enumerated 24 no-payload cases in a PR body and it read as
 * completeness; the reachable no-payload space is over a hundred, and three
 * defects were found in the part nobody had listed. So this file states its own
 * bound in the first test and derives every cell from the axes rather than
 * naming them one at a time.
 */
describe("the Models section over its whole input space", () => {
  it("states its own bound, so no future round can mistake it for completeness", () => {
    // 576 payload cells (2 surfaces x 6 wire states x 4 probe phases x 2 model
    // counts x 2 freshness values x 3 mutation states), 144 local no-payload
    // cells (2 host capabilities x 3 connection states x 8 query facts x 3
    // mutation states) and 128 cloud no-payload cells (8 x 2 x 8). It does NOT
    // cross the local and cloud axes against each other, nor `displayName`.
    expect({
      payload: payloadCells.length,
      localAbsent: localAbsentCells.length,
      cloudAbsent: cloudAbsentCells.length,
    }).toEqual({ payload: 576, localAbsent: 144, cloudAbsent: 128 });
  });



  it("I1/I2: nothing spins unless something is genuinely in flight, and a spin means a poll", () => {
    const bad: string[] = [];
    for (const cell of ALL) {
      const r = resolveAllModelsPresentation(cell);
      if (r.refresh !== "spinning") continue;
      const mutationRunning = cell.isRefreshMutationPending && !cell.isRefreshMutationPaused;
      const polls = resolveAgentLaunchOptionsRefetchInterval({ data: cell.launchOptions }) !== false;
      if (!mutationRunning && !polls) bad.push(JSON.stringify({ kind: r.kind, state: (cell.launchOptions as any)?.state, phase: (cell.launchOptions as any)?.probePhase }));
    }
    expect(bad).toEqual([]);
  });

  it("I3: no arm is a dead end", () => {
    const bad: string[] = [];
    for (const cell of ALL) {
      const r = resolveAllModelsPresentation(cell);
      // The rule governs arms that claim a FAILURE or a WAIT. A settled
      // observation is neither, and an in-flight arm resolves itself by
      // definition, so neither owes the user a cure.
      if (r.kind === "settled_count" || r.kind === "loading" || r.kind === "checking") continue;
      const cure = r.retry !== null || r.refresh === "enabled";
      const selfResolves = /as soon as|when the connection is back|after its first|Models load/i.test(r.detail ?? "");
      const namesAction = /restart|retry|once .+ exists|desktop app|refresh/i.test(r.detail ?? "");
      if (cure || selfResolves || namesAction) continue;
      // The one standing exception, pinned so it cannot spread and cannot be
      // forgotten: a `failed_without_observation` snapshot COPIED to cloud.
      // Cloud has no probe route, so there is no control to offer and no
      // honest self-resolution to promise. Recorded rather than papered over.
      if (cell.surface === "cloud" && r.kind === "failed_without_observation") continue;
      bad.push(`${r.kind} :: ${r.title} :: ${r.detail}`);
    }
    expect(bad).toEqual([]);
  });

  it("I4: cloud never renders a refresh control", () => {
    const bad = ALL.filter((c) => c.surface === "cloud")
      .map((c) => resolveAllModelsPresentation(c).refresh).filter((r) => r !== "absent");
    expect(bad).toEqual([]);
  });

  it("I5: no cell claims silence from a server that answered", () => {
    const bad: string[] = [];
    for (const cell of ALL) {
      const r = resolveAllModelsPresentation(cell);
      if (r.detail !== "Proliferate Cloud didn't respond.") continue;
      // The line describes the query that produced it: the sandbox read is
      // consulted first, so it owns the claim whenever it is the one that
      // failed.
      const source = cell.sandboxQuery.isError ? cell.sandboxQuery : cell.cloudLaunchOptionsQuery;
      const answered = source.serverAnswered;
      if (answered) bad.push(`${r.kind} sandbox=${cell.sandboxQuery.label} lo=${cell.cloudLaunchOptionsQuery.label}`);
    }
    expect(bad).toEqual([]);
  });

  it("I6: a parked mutation never reads as busy, anywhere", () => {
    const bad: string[] = [];
    for (const cell of ALL) {
      if (!cell.isRefreshMutationPaused) continue;
      const r = resolveAllModelsPresentation(cell);
      if (r.refresh === "spinning" || r.refresh === "enabled") bad.push(`${r.kind} -> ${r.refresh}`);
    }
    expect(bad).toEqual([]);
  });

});
