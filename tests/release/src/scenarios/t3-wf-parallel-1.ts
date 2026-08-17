import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { MatrixScenarioDefinition, ScenarioCellOutcome, ScenarioCellSpec } from "./types.js";
import { catalogHarnesses, withGatewayProbedCandidates } from "./t3-chat-1.js";
import { assertWrappedPreamble, type WorkflowRunProjectionV2 } from "./t3-wf-1.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { ApiClient } from "../fixtures/http.js";
import { LocalRuntimeClient, type SessionEventEnvelope } from "../fixtures/local-runtime.js";
import type { PlannedCellV1 } from "../runner/result.js";

/**
 * T3-WF-PARALLEL-1 — a heterogeneous parallel node (ruling F5) plus crash and
 * resume (ruling F6). specs/TESTING/scenarios.md#T3-WF-PARALLEL-1
 *
 * ── Frozen contract, not yet backed by a runtime ────────────────────────────
 * Modeled EXACTLY on `t3-wf-1.ts` (read its module docstring): every wire
 * shape is mirrored structurally from the frozen Workflows gen-2 ADR contract
 * (`anyharness/sdk/src/types/workflow-runs-v2.ts`), `tests/release` carries no
 * dependency on `@anyharness/sdk`, and the `/v1/workflow-runs/*` routes are a
 * parallel lane not in this PR's base. This scenario is authored and
 * registered against the frozen contract only and is NEVER executed here (no
 * cargo/rustc build, no runtime boot, no live run) — the colocated `.test.ts`
 * plans the cell and asserts its shape without running the journey. Two shapes
 * below are rung-forward, flagged for reconciliation on the next restack:
 *   - `legs` on a definition node (this rung 5's grammar, ruling F5); and
 *   - the additive per-node `sessions` rollup on the run projection (rung 7,
 *     ruling F4). Rung 5 durably links each leg by `leg_index` in the fan-in
 *     ledger; the run projection surfaces that as the per-leg `sessions` list
 *     only once rung 7 lands. Until then the rollup read below is the intended
 *     shape, not a shipped one — drift is a finding, not silently absorbed.
 *
 * ── The journey ──────────────────────────────────────────────────────────
 * One `agent` node ("review") fanned out to THREE authored leg prompts — a
 * correctness reviewer, a security reviewer, and a perf reviewer (the panel
 * use case). The run:
 *   1. `PUT /v1/workflow-runs/{run_id}` materializes a workspace and starts the
 *      parallel node, minting one session PER leg (three distinct sessions).
 *   2. Each leg's underlying session prompt carries THAT leg's authored prompt
 *      inside the wrapped preamble — the prompt-to-leg mapping invariant (R4):
 *      the correctness session never carries the security or perf prompt, and
 *      so on. This is the cardinal sin of ruling F5 asserted end to end.
 *   3. Two legs finish; the runtime is killed mid-node with one leg still live.
 *   4. On restart the boot fence parks the node; resume re-fans-out ALL three
 *      legs on a fresh generation (ruling F6): three fresh sessions, a
 *      truncated-then-rebuilt ledger, no orphan session from before the crash.
 *   5. All three legs finish; the node aggregates once (ruling F1: all done)
 *      and the run reaches `completed`.
 * Model resolution reuses T3-CHAT-1's catalog-driven cheapest-Anthropic picker
 * against the fixed harness `claude`, exactly as T3-WF-1 does.
 */
const T3_WF_PARALLEL_1_HARNESS = "claude";

const LEG_PROMPTS = {
  correctness:
    "CORRECTNESS-REVIEW: read the diff and report only logic and correctness " +
    "defects — off-by-one, wrong branch, broken invariant — with file:line evidence.",
  security:
    "SECURITY-REVIEW: read the diff and report only security defects — injection, " +
    "auth bypass, unsafe deserialization, secret exposure — with file:line evidence.",
  perf:
    "PERF-REVIEW: read the diff and report only performance defects — N+1 queries, " +
    "needless allocation, quadratic loops — with file:line evidence.",
} as const;

export const t3WfParallel1: MatrixScenarioDefinition = {
  id: "T3-WF-PARALLEL-1",
  title: "heterogeneous parallel node fan-out with crash and resume",
  registryFlowRef: "specs/TESTING/scenarios.md#T3-WF-PARALLEL-1",
  lanes: ["local"],
  requiredEnv: [],
  kind: "matrix",
  expandCells: (): ScenarioCellSpec[] => [{ dimensions: { harness: T3_WF_PARALLEL_1_HARNESS } }],
  planCell: (_ctx, cell) => [
    {
      description:
        `[${cell.cell_id}] PUT /v1/workflow-runs/{run_id} with a parallel node (three authored leg ` +
        "prompts) materializes a workspace and starts one session per leg (three distinct sessions)",
    },
    {
      description:
        `[${cell.cell_id}] each leg's underlying session prompt carries only that leg's authored prompt ` +
        "inside the wrapped preamble — the prompt-to-leg mapping invariant (R4), no sibling leg's prompt",
    },
    {
      description:
        `[${cell.cell_id}] two legs finish, the runtime is killed with one leg still live, and on restart ` +
        "the boot fence parks the node",
    },
    {
      description:
        `[${cell.cell_id}] resume re-fans-out all three legs on a fresh generation (ruling F6): three ` +
        "fresh sessions, a truncated-then-rebuilt ledger, and no orphan session from before the crash",
    },
    {
      description:
        `[${cell.cell_id}] all three legs finish, the node aggregates once (ruling F1: all done), and the ` +
        "run reaches completed",
    },
    {
      description:
        `[${cell.cell_id}] every command (PUT, GET) returns the full projection {run, nodes[], docs[]} and ` +
        "the parallel node's per-leg sessions rollup (rung 7 shape, reconciled on restack)",
    },
  ],
  runCells: async (_ctx, cells): Promise<ScenarioCellOutcome[]> => {
    assert.equal(cells.length, 1, "T3-WF-PARALLEL-1: exactly one cell is planned (single panel journey)");
    const [cell] = cells;
    const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
    const runtime = new LocalRuntimeClient({ baseUrl: runtimeUrl });
    const workflowClient = new ApiClient({ baseUrl: runtimeUrl });
    try {
      return [await runParallelPanelJourney(runtime, workflowClient, cell)];
    } catch (error) {
      return [
        {
          cellId: cell.cell_id,
          status: "failed",
          reason: { code: "scenario_failure", message: error instanceof Error ? error.message : String(error) },
        },
      ];
    }
  },
};

/**
 * The rung-5/7 fan-out wire shapes, mirrored structurally (see the module
 * docstring). A definition node gains an optional `legs` list; the run
 * projection's node gains an additive read-only `sessions` rollup, one entry
 * per leg keyed by `legIndex` (the durable prompt-to-leg linkage the ledger
 * carries). Both are declared here rather than imported for the same
 * dependency-free reasons T3-WF-1 declares its base shapes.
 */
interface WorkflowNodeModelV2 {
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
}

interface WorkflowSnapshotLegV2 {
  prompt: string;
}

interface WorkflowSnapshotNodeV2 {
  id: string;
  type: "agent" | "human_in_loop";
  title: string;
  prompt: string;
  model?: WorkflowNodeModelV2 | null;
  legs?: WorkflowSnapshotLegV2[] | null;
}

interface WorkflowSnapshotDefinitionV2 {
  schemaVersion: 2;
  nodes: WorkflowSnapshotNodeV2[];
  edges?: { from: string; to: string }[];
  inputs?: { name: string; description?: string; required: boolean }[];
  docTemplates?: { slug: string; producingNodeId: string; body: string }[];
}

interface WorkflowInvocationJsonV2 {
  schemaVersion: 2;
  workflowDefinitionId: string;
  definition: WorkflowSnapshotDefinitionV2;
  arguments: Record<string, string | number | boolean>;
  placement: { repoConfigId: string; mode: "worktree" | "repo_root" };
}

/** Rung 7's additive per-leg rollup (ruling F4), mirrored structurally. */
interface WorkflowRunNodeLegV2 {
  legIndex: number;
  sessionId: string | null;
  status: string;
}

/**
 * A three-leg heterogeneous review panel. Leg 0's prompt equals the node
 * prompt (the representative invariant the validator enforces), so a rung-4
 * one-leg consumer of `node.prompt` still sees a valid prompt.
 */
function reviewPanelDefinition(model: WorkflowNodeModelV2): WorkflowSnapshotDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: [
      {
        id: "review",
        type: "agent",
        title: "Review panel",
        prompt: LEG_PROMPTS.correctness,
        model,
        legs: [
          { prompt: LEG_PROMPTS.correctness },
          { prompt: LEG_PROMPTS.security },
          { prompt: LEG_PROMPTS.perf },
        ],
      },
    ],
    edges: [],
    inputs: [],
    docTemplates: [],
  };
}

/**
 * The real journey (never invoked by the colocated `.test.ts`): PUT the frozen
 * parallel invocation, assert three distinct leg sessions and the per-leg
 * prompt mapping, kill the runtime with one leg live, restart, assert the
 * re-fan-out on resume, and assert the run completes once all legs finish.
 */
async function runParallelPanelJourney(
  runtime: LocalRuntimeClient,
  workflowClient: ApiClient,
  cell: PlannedCellV1,
): Promise<ScenarioCellOutcome> {
  const choices = await catalogHarnesses([T3_WF_PARALLEL_1_HARNESS]);
  const choice = choices.get(T3_WF_PARALLEL_1_HARNESS);
  if (!choice) {
    return {
      cellId: cell.cell_id,
      status: "blocked",
      reason: {
        code: "scenario_blocked",
        message: `T3-WF-PARALLEL-1: no Anthropic-family model found for "${T3_WF_PARALLEL_1_HARNESS}" in catalogs/agents/catalog.json`,
      },
    };
  }
  const candidates = await withGatewayProbedCandidates(runtime, T3_WF_PARALLEL_1_HARNESS, choice.modelCandidates);
  const modelId = candidates[0];
  assert.ok(modelId, "T3-WF-PARALLEL-1: at least one candidate model must be resolvable from the catalog");

  const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
  const repoPath = await ensureLocalClone(githubTestRepo);

  // Mint a real repo-root id exactly as T3-WF-1 does: register a repo root with
  // a throwaway workspace, delete the scratch workspace, and let the run PUT
  // materialize the real workspace.
  const { repoRoot, workspace: scratchWorkspace } = await runtime.createLocalWorkspace(repoPath);
  await runtime.deleteWorkspace(scratchWorkspace.id).catch(() => undefined);

  const runId = randomUUID();
  const definition = reviewPanelDefinition({ agentKind: T3_WF_PARALLEL_1_HARNESS, modelId });
  const invocation: WorkflowInvocationJsonV2 = {
    schemaVersion: 2,
    workflowDefinitionId: randomUUID(),
    definition,
    arguments: {},
    placement: { repoConfigId: repoRoot.id, mode: "repo_root" },
  };

  let materializedWorkspaceId: string | undefined;
  try {
    // 1) PUT materializes a workspace and fans the node out to three sessions.
    let projection = await workflowClient.put<WorkflowRunProjectionV2>(`/v1/workflow-runs/${runId}`, invocation);
    assertFullProjection(projection, "PUT /v1/workflow-runs/{run_id}");
    materializedWorkspaceId = projection.run.workspaceId;
    assert.ok(materializedWorkspaceId, "T3-WF-PARALLEL-1: the PUT response must materialize a workspace");

    const reviewNode = projection.nodes.find((node) => node.definitionNodeId === "review");
    assert.ok(reviewNode, "T3-WF-PARALLEL-1: the projection must carry the defined review node");
    assert.equal(reviewNode!.nodeType, "agent", "T3-WF-PARALLEL-1: the review node must be an agent node");

    // 2) Poll until all three legs have attached a real session, then assert
    //    the prompt-to-leg mapping (R4): each leg's session carries only its
    //    own authored prompt inside the wrapped preamble.
    const legs = await pollForLegSessions(workflowClient, runId, reviewNode!.id, 3, { timeoutMs: 30_000 });
    assert.equal(legs.length, 3, "T3-WF-PARALLEL-1: the parallel node must mint one session per leg (three)");
    const orderedPrompts = [LEG_PROMPTS.correctness, LEG_PROMPTS.security, LEG_PROMPTS.perf];
    const sessionIds = new Set<string>();
    for (const leg of legs) {
      assert.ok(leg.sessionId, `T3-WF-PARALLEL-1: leg ${leg.legIndex} must attach a real session id`);
      sessionIds.add(leg.sessionId!);
      const events = await runtime.getEvents(leg.sessionId!);
      const sentPrompt = findFirstUserPromptText(events);
      assert.ok(sentPrompt, `T3-WF-PARALLEL-1: leg ${leg.legIndex}'s session must record the prompt actually sent`);
      const own = orderedPrompts[leg.legIndex];
      assertWrappedPreamble(sentPrompt!, own);
      for (const [index, sibling] of orderedPrompts.entries()) {
        if (index !== leg.legIndex) {
          assert.ok(
            !sentPrompt!.includes(sibling),
            `T3-WF-PARALLEL-1: leg ${leg.legIndex}'s prompt must not carry leg ${index}'s authored prompt (R4)`,
          );
        }
      }
    }
    assert.equal(sessionIds.size, 3, "T3-WF-PARALLEL-1: the three leg sessions must be distinct");

    // 3) Let two legs finish, then crash the runtime with one leg still live.
    //    The runtime kill+restart is performed OUT OF BAND by the release
    //    runner's process supervisor (the same seam the T4 upgrade scenarios
    //    use — there is no LocalRuntimeClient kill method, deliberately), so
    //    this authored journey marks the boundary and then asserts the
    //    post-restart state through the HTTP surface only.
    await pollRunProjection(
      workflowClient,
      runId,
      (candidate) => legsDoneCount(candidate, reviewNode!.id) >= 2,
      { timeoutMs: 180_000 },
    );
    await crashAndRestartRuntimeOutOfBand();

    // 4) After restart the boot fence has parked the node; resume re-fans-out
    //    all three legs on a fresh generation.
    projection = await pollRunProjection(
      workflowClient,
      runId,
      (candidate) => candidate.run.status === "interrupted",
      { timeoutMs: 60_000 },
    );
    assertFullProjection(projection, "GET /v1/workflow-runs/{run_id} (post-restart)");
    const fencedNode = projection.nodes.find((node) => node.definitionNodeId === "review");
    assert.equal(
      fencedNode?.status,
      "needs_attention",
      "T3-WF-PARALLEL-1: the boot fence must park the parallel node needs_attention (ruling K)",
    );
    const resumed = await workflowClient.post<WorkflowRunProjectionV2>(`/v1/workflow-runs/${runId}/resume`, {});
    assertFullProjection(resumed, "POST .../resume");
    const refanned = await pollForLegSessions(workflowClient, runId, reviewNode!.id, 3, { timeoutMs: 30_000 });
    assert.equal(refanned.length, 3, "T3-WF-PARALLEL-1: resume must re-fan-out all three legs (ruling F6)");
    for (const leg of refanned) {
      assert.ok(leg.sessionId, `T3-WF-PARALLEL-1: resumed leg ${leg.legIndex} must attach a fresh session`);
      assert.ok(
        !sessionIds.has(leg.sessionId!),
        `T3-WF-PARALLEL-1: resumed leg ${leg.legIndex}'s session must be fresh, not a pre-crash orphan`,
      );
    }

    // 5) All legs finish; the node aggregates once and the run completes.
    const finalProjection = await pollRunProjection(
      workflowClient,
      runId,
      (candidate) => candidate.run.status === "completed" || candidate.run.status === "failed",
      { timeoutMs: 180_000 },
    );
    assert.equal(
      finalProjection.run.status,
      "completed",
      `T3-WF-PARALLEL-1: all legs done must complete the run (got ${finalProjection.run.status}, ` +
        `failureCode=${finalProjection.run.failureCode})`,
    );
    const finalNode = finalProjection.nodes.find((node) => node.definitionNodeId === "review");
    assert.equal(finalNode?.status, "completed", "T3-WF-PARALLEL-1: the parallel node must complete once (ruling F1)");

    return { cellId: cell.cell_id, status: "green" };
  } finally {
    if (materializedWorkspaceId) {
      await runtime.deleteWorkspace(materializedWorkspaceId).catch(() => undefined);
    }
  }
}

function assertFullProjection(projection: WorkflowRunProjectionV2, whichCommand: string): void {
  assert.ok(
    projection && typeof projection === "object" && typeof projection.run?.id === "string",
    `T3-WF-PARALLEL-1: ${whichCommand} must return the full projection's run`,
  );
  assert.ok(Array.isArray(projection.nodes), `T3-WF-PARALLEL-1: ${whichCommand} must return the full projection's nodes[]`);
  assert.ok(Array.isArray(projection.docs), `T3-WF-PARALLEL-1: ${whichCommand} must return the full projection's docs[]`);
}

/**
 * The parallel node's per-leg rollup (rung 7 shape, ruling F4). Read off the
 * node projection structurally; until rung 7 lands, this is the intended
 * shape to reconcile against the real SDK type on restack.
 */
function legsOf(projection: WorkflowRunProjectionV2, nodeRowId: string): WorkflowRunNodeLegV2[] {
  const node = projection.nodes.find((candidate) => candidate.id === nodeRowId) as
    | (WorkflowRunProjectionV2["nodes"][number] & { sessions?: WorkflowRunNodeLegV2[] })
    | undefined;
  return node?.sessions ?? [];
}

function legsDoneCount(projection: WorkflowRunProjectionV2, nodeRowId: string): number {
  return legsOf(projection, nodeRowId).filter((leg) => leg.status === "done").length;
}

async function pollForLegSessions(
  client: ApiClient,
  runId: string,
  nodeRowId: string,
  expected: number,
  options: { timeoutMs: number; pollMs?: number },
): Promise<WorkflowRunNodeLegV2[]> {
  const projection = await pollRunProjection(
    client,
    runId,
    (candidate) => legsOf(candidate, nodeRowId).filter((leg) => leg.sessionId != null).length >= expected,
    options,
  );
  return legsOf(projection, nodeRowId)
    .filter((leg) => leg.sessionId != null)
    .sort((a, b) => a.legIndex - b.legIndex);
}

async function pollRunProjection(
  client: ApiClient,
  runId: string,
  until: (projection: WorkflowRunProjectionV2) => boolean,
  options: { timeoutMs: number; pollMs?: number },
): Promise<WorkflowRunProjectionV2> {
  const pollMs = options.pollMs ?? 2000;
  const deadline = Date.now() + options.timeoutMs;
  let last = await client.get<WorkflowRunProjectionV2>(`/v1/workflow-runs/${runId}`);
  while (!until(last) && Date.now() < deadline) {
    await sleep(pollMs);
    last = await client.get<WorkflowRunProjectionV2>(`/v1/workflow-runs/${runId}`);
  }
  return last;
}

/**
 * Mirrors T3-WF-1's `findFirstUserPromptText` (the fixture does not export it):
 * the first user-message text in a session's event log — the prompt actually
 * sent to the harness, used for the per-leg prompt-to-leg assertion.
 */
function findFirstUserPromptText(events: SessionEventEnvelope[]): string | undefined {
  for (const entry of events) {
    const event = entry.event as {
      type: string;
      item?: { kind?: string; contentParts?: Array<{ type: string; text?: string }> };
    };
    if (event.type === "item_completed" && event.item?.kind === "user_message") {
      const text = event.item.contentParts?.find((part) => part.type === "text")?.text;
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

/**
 * The crash/resume boundary (ruling F6). A real runtime kill+restart is a
 * process-supervisor operation the release runner owns out of band — there is
 * no LocalRuntimeClient method for it, by design — so this authored,
 * never-executed journey marks the boundary explicitly. When this scenario is
 * wired for real on the next restack, replace this with the runner's
 * supervisor hook (the same one the T4 upgrade scenarios drive).
 */
async function crashAndRestartRuntimeOutOfBand(): Promise<void> {
  throw new Error(
    "T3-WF-PARALLEL-1: runtime crash+restart is an out-of-band supervisor step; " +
      "this scenario is authored against the frozen contract and not executed in this PR",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
