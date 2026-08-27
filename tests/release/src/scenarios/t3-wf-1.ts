import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { MatrixScenarioDefinition, ScenarioCellOutcome, ScenarioCellSpec } from "./types.js";
import { catalogHarnesses, withGatewayProbedCandidates } from "./t3-chat-1.js";
import { DEFAULT_GITHUB_TEST_REPO, DEFAULT_LOCAL_RUNTIME_URL } from "../config/env-manifest.js";
import { ensureLocalClone } from "../fixtures/git.js";
import { ApiClient } from "../fixtures/http.js";
import { LocalRuntimeClient, type SessionEventEnvelope } from "../fixtures/local-runtime.js";
import type { PlannedCellV1 } from "../runner/result.js";

/**
 * T3-WF-1 — two-node reference workflow run: research then human review.
 * tests/release/core-release-scenario-manifest.json#T3-WF-1
 *
 * ── Frozen contract, not yet backed by a runtime ────────────────────────────
 * Every wire shape below is mirrored STRUCTURALLY (not imported) from the
 * frozen Workflows gen-2 ADR contract,
 * `anyharness/sdk/src/types/workflow-runs-v2.ts` — that file's own header
 * explains why: "@anyharness/sdk is dependency-free, so the invocation-json
 * shapes... are declared here structurally rather than imported;
 * TypeScript's structural typing keeps the two declarations assignable."
 * `tests/release` carries no dependency on `@anyharness/sdk` either (see its
 * package.json), so the same reasoning applies one hop further out. That SDK
 * file also records: "The Rust routes land in the gen-2 ladder's PR5a; once
 * that PR is in this chain's base, `make sdk-generate` regenerates the
 * canonical OpenAPI types and this file is reconciled against them." PR5a is
 * a parallel lane (Lane R) and is NOT in this PR's base — the local AnyHarness
 * runtime does not yet serve `/v1/workflow-runs/*` for real. This scenario is
 * authored and registered against the frozen contract only; per this PR's own
 * task constraints it is never executed here (no cargo/rustc build, no
 * runtime boot, no live run). Reconcile the mirrored types/placement
 * resolution below against PR5a's real routes on the next restack — drift is
 * a finding, not silently absorbed, exactly as the SDK file itself plans for.
 *
 * ── The journey ──────────────────────────────────────────────────────────
 * The definition mirrors the shipped "Bug investigation" starter template
 * verbatim (`apps/packages/product-client/src/config/workflows/
 * starter-templates.ts`'s `BUG_INVESTIGATION`, node ids/prompts/docTemplate
 * copied unchanged below plus the resolved model attached to the research
 * node) — duplicated rather than imported because `tests/release` has no
 * dependency on `@proliferate/product-client` (see its package.json); the
 * colocated `.test.ts` guards the two copies against silent drift. The run:
 * one `agent` node ("research") whose prompt uses `@input:question` and
 * writes into `@doc:findings`, then one `human_in_loop` node ("review") that
 * gates completion. Model resolution reuses T3-CHAT-1's catalog-driven
 * cheapest-Anthropic-family picker (`catalogHarnesses`/
 * `withGatewayProbedCandidates`) against the fixed starting harness `claude`,
 * the same pattern T3-SESSION-1 uses for its own single fixed-harness cell.
 *
 * Six real assertions this scenario carries, per the frozen contract:
 * 1. `PUT /v1/workflow-runs/{run_id}` with the frozen invocation body
 *    `{schemaVersion: 2, workflowDefinitionId, definition, arguments,
 *    placement}` materializes a workspace and starts node 1.
 * 2. The agent node's session prompt honors the runtime's wrapped preamble
 *    (assert the wrapper's presence, not its exact text).
 * 3. The findings doc materializes as a REAL file under `.proliferate/context/<run_id>/`
 *    in the materialized workspace.
 * 4. The run parks at the human gate: `run.status === "awaiting_human"`, the
 *    gate node is `awaiting_human`, and it HOLDS — no auto-advance.
 * 5. `POST .../nodes/{gate}/approve` advances the gate; the run reaches
 *    `completed`.
 * 6. Every command (PUT, GET, approve) returns the full projection
 *    `{run, nodes[], docs[]}`.
 */
const T3_WF_1_HARNESS = "claude";

export const t3Wf1: MatrixScenarioDefinition = {
  id: "T3-WF-1",
  title: "two-node reference workflow run: research then human review",
  registryFlowRef: "tests/release/core-release-scenario-manifest.json#T3-WF-1",
  lanes: ["local"],
  requiredEnv: [],
  kind: "matrix",
  expandCells: (): ScenarioCellSpec[] => [{ dimensions: { harness: T3_WF_1_HARNESS } }],
  planCell: (_ctx, cell) => [
    {
      description:
        `[${cell.cell_id}] PUT /v1/workflow-runs/{run_id} with the frozen invocation body ` +
        "{schemaVersion: 2, workflowDefinitionId, definition, arguments, placement} materializes a " +
        "workspace and starts node 1 (research, agent)",
    },
    {
      description:
        `[${cell.cell_id}] the research node's underlying session prompt honors the runtime's wrapped ` +
        "preamble around the raw @input:/@doc: node prompt (assert the wrapper's presence, not its exact text)",
    },
    {
      description:
        `[${cell.cell_id}] the findings doc materializes as a real file under .proliferate/context/<run_id>/ in the ` +
        "materialized workspace",
    },
    {
      description:
        `[${cell.cell_id}] the run parks at the human gate: run status awaiting_human, gate node ` +
        "awaiting_human, and it HOLDS with no auto-advance",
    },
    {
      description:
        `[${cell.cell_id}] POST .../nodes/{gate}/approve advances the gate and the run reaches completed`,
    },
    {
      description:
        `[${cell.cell_id}] every command (PUT, GET, approve) returns the full projection {run, nodes[], docs[]}`,
    },
  ],
  runCells: async (_ctx, cells): Promise<ScenarioCellOutcome[]> => {
    assert.equal(cells.length, 1, "T3-WF-1: exactly one cell is planned (single reference journey)");
    const [cell] = cells;
    const runtimeUrl = process.env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL;
    const runtime = new LocalRuntimeClient({ baseUrl: runtimeUrl });
    const workflowClient = new ApiClient({ baseUrl: runtimeUrl });
    try {
      return [await runResearchAndReviewJourney(runtime, workflowClient, cell)];
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
 * Workflows gen-2 runtime-plane wire types, mirrored structurally from
 * `anyharness/sdk/src/types/workflow-runs-v2.ts` (the frozen ADR contract).
 * See the module docstring above for why this is a deliberate structural
 * copy rather than an import.
 */
type WorkflowNodeTypeV2 = "agent" | "human_in_loop";

interface WorkflowNodeModelV2 {
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
}

interface WorkflowSnapshotNodeV2 {
  id: string;
  type: WorkflowNodeTypeV2;
  title: string;
  prompt: string;
  model?: WorkflowNodeModelV2 | null;
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

type WorkflowRunStatusV2 = "running" | "awaiting_human" | "interrupted" | "completed" | "failed";
type WorkflowRunNodeStatusV2 = "pending" | "running" | "needs_attention" | "awaiting_human" | "completed" | "failed";
type WorkflowRunNodeKindV2 = "defined" | "replacement" | "adhoc";

interface WorkflowRunV2 {
  id: string;
  invocationId: string;
  definitionJson: string;
  argumentsJson: string;
  workspaceId: string;
  status: WorkflowRunStatusV2;
  currentNodeRowId: string | null;
  failureCode: string | null;
  interruptionCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface WorkflowRunNodeV2 {
  id: string;
  runId: string;
  definitionNodeId: string | null;
  kind: WorkflowRunNodeKindV2;
  nodeType: WorkflowNodeTypeV2;
  replacesNodeRowId: string | null;
  anchorNodeRowId: string | null;
  chainIndex: number | null;
  title: string;
  prompt: string;
  status: WorkflowRunNodeStatusV2;
  sessionId: string | null;
  promptId: string | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface WorkflowRunDocV2 {
  id: string;
  runId: string;
  slug: string;
  filename: string;
  producingNodeRowId: string | null;
  seededFromTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The full projection every read and every command returns:
 * `GET /v1/workflow-runs/{run_id}` and each POST command body's response.
 */
export interface WorkflowRunProjectionV2 {
  run: WorkflowRunV2;
  nodes: WorkflowRunNodeV2[];
  docs: WorkflowRunDocV2[];
}

/**
 * The "Bug investigation" starter template's definition, copied verbatim
 * (node ids, titles, prompts, edges, inputs, docTemplates) from
 * `apps/packages/product-client/src/config/workflows/
 * starter-templates.ts`'s `BUG_INVESTIGATION`, with the resolved model
 * attached to the research node. The colocated `.test.ts` guards this copy
 * against silent drift from the shipped template.
 */
export function bugInvestigationDefinition(model: WorkflowNodeModelV2): WorkflowSnapshotDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: [
      {
        id: "research",
        type: "agent",
        title: "Research",
        prompt:
          "Investigate @input:question. Read the code rather than guessing, and " +
          "write what you find into @doc:findings — answers first, then the " +
          "file-and-line evidence for each.",
        model,
      },
      {
        id: "review",
        type: "human_in_loop",
        title: "Review the findings",
        prompt:
          "Read @doc:findings. Approve to complete the run, or redo the research " +
          "node with a sharper question.",
      },
    ],
    edges: [{ from: "research", to: "review" }],
    inputs: [
      {
        name: "question",
        description: "The question to investigate.",
        required: true,
      },
    ],
    docTemplates: [
      {
        slug: "findings",
        producingNodeId: "research",
        body: "# Findings\n\n## Answers\n\n## Evidence\n\nFile-and-line pointers backing each answer.\n",
      },
    ],
  };
}

/**
 * The real journey: mints a repo root + model, PUTs the frozen invocation,
 * follows node 1 (research) through a real turn, asserts the wrapped
 * preamble and the materialized findings file, asserts the human-gate hold,
 * approves it, and asserts the run reaches `completed`. Never invoked by the
 * colocated `.test.ts` (see the module docstring: never executed in this PR).
 */
async function runResearchAndReviewJourney(
  runtime: LocalRuntimeClient,
  workflowClient: ApiClient,
  cell: PlannedCellV1,
): Promise<ScenarioCellOutcome> {
  const choices = await catalogHarnesses([T3_WF_1_HARNESS]);
  const choice = choices.get(T3_WF_1_HARNESS);
  if (!choice) {
    return {
      cellId: cell.cell_id,
      status: "blocked",
      reason: {
        code: "scenario_blocked",
        message: `T3-WF-1: no Anthropic-family model found for "${T3_WF_1_HARNESS}" in catalogs/agents/catalog.json`,
      },
    };
  }
  const candidates = await withGatewayProbedCandidates(runtime, T3_WF_1_HARNESS, choice.modelCandidates);
  const modelId = candidates[0];
  assert.ok(modelId, "T3-WF-1: at least one candidate model must be resolvable from the catalog");

  const githubTestRepo = process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO;
  const repoPath = await ensureLocalClone(githubTestRepo);

  // Mint a real repo-root id to reference from `placement.repoConfigId`. The
  // frozen ADR type names a `repoConfigId` in "repo_root" | "worktree" mode;
  // the CURRENT local runtime API only registers a repo root together with a
  // throwaway workspace (`POST /v1/workspaces`), so that scratch workspace is
  // deleted right after minting the id and never reused for the run itself —
  // the workflow-run PUT below is what must materialize the REAL workspace
  // (assertion 1). "repo_root" mode is chosen over "worktree" because this
  // journey needs no isolation from the base checkout. Reconcile this
  // resolution against PR5a's real semantics once its routes land.
  const { repoRoot, workspace: scratchWorkspace } = await runtime.createLocalWorkspace(repoPath);
  await runtime.deleteWorkspace(scratchWorkspace.id).catch(() => undefined);

  const runId = randomUUID();
  const definition = bugInvestigationDefinition({ agentKind: T3_WF_1_HARNESS, modelId });
  const invocation: WorkflowInvocationJsonV2 = {
    schemaVersion: 2,
    workflowDefinitionId: randomUUID(),
    definition,
    arguments: {
      question:
        `In this repository (${githubTestRepo}), what does the top-level README say the project is, ` +
        "and which top-level directories back that claim up?",
    },
    placement: { repoConfigId: repoRoot.id, mode: "repo_root" },
  };

  let materializedWorkspaceId: string | undefined;
  try {
    // 1) PUT materializes a workspace and starts node 1.
    let projection = await workflowClient.put<WorkflowRunProjectionV2>(`/v1/workflow-runs/${runId}`, invocation);
    assertFullProjection(projection, "PUT /v1/workflow-runs/{run_id}");
    materializedWorkspaceId = projection.run.workspaceId;
    assert.ok(materializedWorkspaceId, "T3-WF-1: the PUT response must materialize a workspace (run.workspaceId)");

    const researchNode = projection.nodes.find((node) => node.definitionNodeId === "research");
    const gateNode = projection.nodes.find((node) => node.definitionNodeId === "review");
    assert.ok(researchNode, "T3-WF-1: the projection must carry the defined research node");
    assert.ok(gateNode, "T3-WF-1: the projection must carry the defined review gate node");
    assert.equal(researchNode!.nodeType, "agent", "T3-WF-1: the research node must be an agent node");
    assert.equal(gateNode!.nodeType, "human_in_loop", "T3-WF-1: the review node must be a human_in_loop node");
    assert.notEqual(
      researchNode!.status,
      "pending",
      "T3-WF-1: node 1 (research) must have started immediately, not stay pending",
    );

    // 2) The research node's session prompt honors the wrapped preamble.
    const sessionId = await pollForSessionId(workflowClient, runId, researchNode!.id, { timeoutMs: 30_000 });
    assert.ok(sessionId, "T3-WF-1: node 1 must attach a real AnyHarness session id");
    const events = await runtime.getEvents(sessionId!);
    const sentPrompt = findFirstUserPromptText(events);
    assert.ok(sentPrompt, "T3-WF-1: the underlying session must record the prompt actually sent");
    assertWrappedPreamble(sentPrompt!, definition.nodes[0].prompt);

    // Node 1 completes for real.
    projection = await pollRunProjection(
      workflowClient,
      runId,
      (candidate) => {
        const node = candidate.nodes.find((n) => n.definitionNodeId === "research");
        return node?.status === "completed" || node?.status === "failed" || candidate.run.status === "failed";
      },
      { timeoutMs: 180_000 },
    );
    assertFullProjection(projection, "GET /v1/workflow-runs/{run_id} (poll node 1)");
    const completedResearchNode = projection.nodes.find((node) => node.definitionNodeId === "research");
    assert.equal(
      completedResearchNode?.status,
      "completed",
      `T3-WF-1: node 1 (research) must complete for real (run status=${projection.run.status}, ` +
        `failureCode=${projection.run.failureCode})`,
    );

    // 3) The findings doc materializes as a real file.
    const findingsDoc = projection.docs.find((doc) => doc.slug === "findings");
    assert.ok(findingsDoc, "T3-WF-1: the run must carry the findings doc seeded from the docTemplates");
    const workspaces = await runtime.listWorkspaces();
    const workspace = workspaces.find((candidate) => candidate.id === projection.run.workspaceId);
    assert.ok(workspace, "T3-WF-1: the materialized workspace must still be resolvable by id");
    const docPath = path.join(workspace!.path, ".proliferate", "context", runId, findingsDoc!.filename);
    const docContent = await readFile(docPath, "utf8");
    assert.ok(docContent.trim().length > 0, `T3-WF-1: the findings doc must be a real, non-empty file at ${docPath}`);

    // 4) The run parks at the human gate and HOLDS.
    assert.equal(
      projection.run.status,
      "awaiting_human",
      "T3-WF-1: after node 1 completes the run must park at awaiting_human",
    );
    const parkedGateNode = projection.nodes.find((node) => node.definitionNodeId === "review");
    assert.equal(parkedGateNode?.status, "awaiting_human", "T3-WF-1: the review gate node must be awaiting_human");
    await assertNoAutoAdvance(workflowClient, runId, { holdMs: 10_000 });

    // 5) approve advances the gate; the run reaches completed.
    const approved = await workflowClient.post<WorkflowRunProjectionV2>(
      `/v1/workflow-runs/${runId}/nodes/${parkedGateNode!.id}/approve`,
      {},
    );
    assertFullProjection(approved, "POST .../nodes/{gate}/approve");
    const finalProjection =
      approved.run.status === "completed"
        ? approved
        : await pollRunProjection(
            workflowClient,
            runId,
            (candidate) => candidate.run.status === "completed" || candidate.run.status === "failed",
            { timeoutMs: 30_000 },
          );
    assert.equal(
      finalProjection.run.status,
      "completed",
      `T3-WF-1: approving the gate must reach a completed run (got ${finalProjection.run.status}, ` +
        `failureCode=${finalProjection.run.failureCode})`,
    );
    const finalGateNode = finalProjection.nodes.find((node) => node.definitionNodeId === "review");
    assert.equal(finalGateNode?.status, "completed", "T3-WF-1: the review gate node must complete");

    return { cellId: cell.cell_id, status: "green" };
  } finally {
    if (materializedWorkspaceId) {
      await runtime.deleteWorkspace(materializedWorkspaceId).catch(() => undefined);
    }
  }
}

// 6) every command's response is checked against the full projection shape.
function assertFullProjection(projection: WorkflowRunProjectionV2, whichCommand: string): void {
  assert.ok(
    projection && typeof projection === "object" && typeof projection.run?.id === "string",
    `T3-WF-1: ${whichCommand} must return the full projection's run`,
  );
  assert.ok(Array.isArray(projection.nodes), `T3-WF-1: ${whichCommand} must return the full projection's nodes[]`);
  assert.ok(Array.isArray(projection.docs), `T3-WF-1: ${whichCommand} must return the full projection's docs[]`);
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

async function pollForSessionId(
  client: ApiClient,
  runId: string,
  nodeRowId: string,
  options: { timeoutMs: number; pollMs?: number },
): Promise<string | undefined> {
  const projection = await pollRunProjection(
    client,
    runId,
    (candidate) => candidate.nodes.find((node) => node.id === nodeRowId)?.sessionId != null,
    options,
  );
  return projection.nodes.find((node) => node.id === nodeRowId)?.sessionId ?? undefined;
}

/**
 * Mirrors `findLastAssistantReply`'s `item_completed`/`contentParts` shape
 * (`../fixtures/local-runtime.ts`) for the USER side of a session's event
 * log. Not exported from that fixture today — no scenario before this one
 * needed the exact prompt TEXT actually sent to the harness, only that a
 * reply arrived.
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
 * Assertion 2: the runtime wraps a workflow node's raw prompt in a preamble
 * before sending it to the underlying AnyHarness session. Assert the
 * wrapper's PRESENCE (the sent text differs from the raw node prompt, but
 * still carries it unchanged inside), never the wrapper's exact wording —
 * that text is a runtime implementation detail this scenario does not own.
 */
export function assertWrappedPreamble(sentPromptText: string, rawNodePrompt: string): void {
  assert.notEqual(
    sentPromptText.trim(),
    rawNodePrompt.trim(),
    "T3-WF-1: the runtime must wrap the node's raw prompt in a preamble, not send it verbatim",
  );
  assert.ok(
    sentPromptText.includes(rawNodePrompt.trim()),
    "T3-WF-1: the wrapped prompt must still carry the node's raw prompt text, unchanged, inside it",
  );
}

/**
 * Assertion 4's hold half: polls across a bounded window and asserts the run
 * and gate node stay `awaiting_human` throughout — no silent auto-advance.
 */
async function assertNoAutoAdvance(
  client: ApiClient,
  runId: string,
  options: { holdMs: number; pollMs?: number },
): Promise<void> {
  const pollMs = options.pollMs ?? 2000;
  const deadline = Date.now() + options.holdMs;
  while (Date.now() < deadline) {
    const projection = await client.get<WorkflowRunProjectionV2>(`/v1/workflow-runs/${runId}`);
    assert.equal(
      projection.run.status,
      "awaiting_human",
      "T3-WF-1: the run must hold at awaiting_human with no auto-advance",
    );
    const gateNode = projection.nodes.find((node) => node.definitionNodeId === "review");
    assert.equal(
      gateNode?.status,
      "awaiting_human",
      "T3-WF-1: the gate node must hold awaiting_human with no auto-advance",
    );
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
