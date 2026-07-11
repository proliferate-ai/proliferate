/**
 * Run-from-chat launch model (spec `workflows-run-from-chat.md`, R1–R6).
 *
 * Pure helpers the three launch doors (composer picker, workflows-tab Run,
 * new-chat recommended strip) render from — no network, no storage. Callers
 * own persistence (last-used memory) and I/O (StartRun POST).
 *
 * - R2/R3 `buildStartRunBody`: the StartRun wire body. Fresh-by-default —
 *   a slot with no binding (or a `"new"` / null choice) is omitted, so the
 *   server opens a new session; bind-existing is the explicit minority path
 *   that emits a `{slot: sessionId}` entry.
 * - R5 `orderRecommendedWorkflows`: the strip order — most-recently-run
 *   first, never-run entries (incl. freshly-seeded ones) retained at the
 *   tail, with per-workflow integration-readiness annotation (honesty rule).
 * - R6 last-used target: a per-workflow memory record round-trip plus a
 *   `deriveLastUsedTarget` read over run history for the no-memory fallback.
 * - Composer door (R1's third entry point): `resolveChatOriginTarget` (the
 *   chat's own workspace wins over last-used) + `withCurrentSessionCandidate`
 *   (the current session is offered first, same-harness) +
 *   `isBindableSessionCandidate` (B8/L29 eligibility: harness match AND same
 *   target workspace — mirrors the server's StartRun validation client-side
 *   so the picker never offers a session the server would reject).
 */

import type { WorkflowTargetMode } from "./model";

// --- R2/R3: StartRun payload ---------------------------------------------------

export type WorkflowLaunchArgValue = string | number | boolean;

/** Sentinel a picker uses for the fresh-session choice (R3 default). */
export const FRESH_SESSION_CHOICE = "new";

/** One slot's session choice. `null`/`"new"` = fresh (default); else an
 * existing live-session id to bind (L29/E8). */
export interface SlotSessionBinding {
  slot: string;
  sessionId: string | null;
}

export interface BuildStartRunInput {
  inputs: Record<string, WorkflowLaunchArgValue>;
  targetMode: WorkflowTargetMode;
  /** Cloud workspace id — the delivery destination for `personal_cloud`. */
  cloudWorkspaceId?: string | null;
  /** Local runtime workspace id — the desktop delivers the plan itself, but the
   * wire target still requires exactly one of workspaceId/triggerId (B9 XOR);
   * for a local run this is the desktop workspace, not server-validated. */
  localWorkspaceId?: string | null;
  /** Per-slot bindings. Slots absent, or bound to `"new"`/null, run fresh. */
  sessionBindings?: readonly SlotSessionBinding[];
  /** Pin a specific published version; omitted = latest. */
  versionId?: string | null;
}

/** Mirror of the OpenAPI `StartRunRequest` (camelCase, target XOR). */
export interface StartRunWireBody {
  inputs: Record<string, WorkflowLaunchArgValue>;
  targetMode: WorkflowTargetMode;
  target: { workspaceId?: string; triggerId?: string };
  sessionBindings?: Record<string, string>;
  versionId?: string;
}

/** Whether a slot choice means "bind this existing session" (vs fresh). */
export function isExistingSessionChoice(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId) && sessionId !== FRESH_SESSION_CHOICE;
}

export function buildStartRunBody(input: BuildStartRunInput): StartRunWireBody {
  const target: { workspaceId?: string } = {};
  if (input.targetMode === "personal_cloud" && input.cloudWorkspaceId) {
    target.workspaceId = input.cloudWorkspaceId;
  } else if (input.targetMode === "local" && input.localWorkspaceId) {
    target.workspaceId = input.localWorkspaceId;
  }

  const bindings: Record<string, string> = {};
  for (const binding of input.sessionBindings ?? []) {
    if (isExistingSessionChoice(binding.sessionId)) {
      // narrowed by the guard above
      bindings[binding.slot] = binding.sessionId as string;
    }
  }

  const body: StartRunWireBody = {
    inputs: input.inputs,
    targetMode: input.targetMode,
    target,
  };
  if (Object.keys(bindings).length > 0) {
    body.sessionBindings = bindings;
  }
  if (input.versionId) {
    body.versionId = input.versionId;
  }
  return body;
}

// --- R6: last-used target ------------------------------------------------------

export interface LastUsedTarget {
  targetMode: WorkflowTargetMode;
  /** The workspace within the mode; null when none was recorded. */
  workspaceId: string | null;
}

/** Per-workflow last-used target, keyed by workflow id (client memory). */
export type LastUsedTargetMemory = Record<string, LastUsedTarget>;

/** Immutably record the target a workflow last ran with (R6). */
export function rememberTarget(
  memory: LastUsedTargetMemory,
  workflowId: string,
  target: LastUsedTarget,
): LastUsedTargetMemory {
  return { ...memory, [workflowId]: target };
}

/** Recall a workflow's last-used target, or null if none is remembered. */
export function recallTarget(
  memory: LastUsedTargetMemory,
  workflowId: string,
): LastUsedTarget | null {
  return memory[workflowId] ?? null;
}

export interface WorkflowRunTargetRecord {
  workflowId: string;
  /** ISO timestamp; nullish/unparseable rows are ignored. */
  createdAt: string | null;
  targetMode: WorkflowTargetMode;
  workspaceId: string | null;
}

/**
 * Derive a workflow's last-used target from run history — the no-memory
 * fallback (R6: "run rows already store the workspace"). Picks the most
 * recent parseable run for the workflow.
 */
export function deriveLastUsedTarget(
  runs: readonly WorkflowRunTargetRecord[],
  workflowId: string,
): LastUsedTarget | null {
  let best: { ms: number; target: LastUsedTarget } | null = null;
  for (const run of runs) {
    if (run.workflowId !== workflowId) {
      continue;
    }
    const ms = run.createdAt ? Date.parse(run.createdAt) : Number.NaN;
    if (Number.isNaN(ms)) {
      continue;
    }
    if (!best || ms > best.ms) {
      best = { ms, target: { targetMode: run.targetMode, workspaceId: run.workspaceId } };
    }
  }
  return best?.target ?? null;
}

// --- R5: recommended-strip ordering + readiness --------------------------------

export interface IntegrationReadiness {
  ready: boolean;
  /** Declared namespaces the org has not connected. */
  missing: string[];
}

/**
 * Pre-check a workflow's declared integrations against the org's connected
 * providers (honesty rule, arch §8.4). A derived read — no new column.
 */
export function annotateIntegrationReadiness(
  integrations: readonly string[],
  connectedProviders: Iterable<string>,
): IntegrationReadiness {
  const connected = new Set(connectedProviders);
  const missing = integrations.filter((namespace) => !connected.has(namespace));
  return { ready: missing.length === 0, missing };
}

export interface RecommendedWorkflowInput {
  id: string;
  name: string;
  description?: string | null;
  /** Declared integration namespaces (drives readiness). */
  integrations?: readonly string[];
  /** Harness kinds present in the definition, for provider icons. */
  providers?: readonly string[];
}

export interface WorkflowRunRecency {
  workflowId: string;
  /** ISO timestamp of the run (created/started); nullish = never/unknown. */
  createdAt: string | null;
}

export interface RecommendedWorkflowView {
  id: string;
  name: string;
  description: string | null;
  integrations: string[];
  providers: string[];
  /** Epoch ms of the workflow's latest run, or null if never run. */
  lastRunAtMs: number | null;
  readiness: IntegrationReadiness;
}

/** Latest parseable run time per workflow. */
export function latestRunMsByWorkflow(
  runs: readonly WorkflowRunRecency[],
): Map<string, number> {
  const latest = new Map<string, number>();
  for (const run of runs) {
    const ms = run.createdAt ? Date.parse(run.createdAt) : Number.NaN;
    if (Number.isNaN(ms)) {
      continue;
    }
    const existing = latest.get(run.workflowId);
    if (existing === undefined || ms > existing) {
      latest.set(run.workflowId, ms);
    }
  }
  return latest;
}

export interface OrderRecommendedOptions {
  /** Org-connected provider namespaces, for readiness annotation. */
  connectedProviders?: Iterable<string>;
  /** Cap the strip length; unset = all. */
  limit?: number;
}

/**
 * The R5 recommended strip: org workflows ordered most-recently-run first,
 * never-run entries (incl. freshly-seeded workflows with no runs yet) kept
 * at the tail in their incoming order. Stable — equal-recency ties preserve
 * input order (the caller sorts seeds/recents upstream if it wants a
 * different tiebreak).
 */
export function orderRecommendedWorkflows(
  workflows: readonly RecommendedWorkflowInput[],
  runs: readonly WorkflowRunRecency[],
  options: OrderRecommendedOptions = {},
): RecommendedWorkflowView[] {
  const latest = latestRunMsByWorkflow(runs);
  const connected = options.connectedProviders ?? [];
  const readinessConnected = new Set(connected);

  const decorated = workflows.map((workflow, index) => {
    const integrations = [...(workflow.integrations ?? [])];
    const missing = integrations.filter((namespace) => !readinessConnected.has(namespace));
    const view: RecommendedWorkflowView = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? null,
      integrations,
      providers: [...(workflow.providers ?? [])],
      lastRunAtMs: latest.get(workflow.id) ?? null,
      readiness: { ready: missing.length === 0, missing },
    };
    return { view, index };
  });

  decorated.sort((a, b) => {
    const ra = a.view.lastRunAtMs;
    const rb = b.view.lastRunAtMs;
    if (ra !== null && rb !== null) {
      if (rb !== ra) {
        return rb - ra;
      }
    } else if (ra !== null) {
      return -1;
    } else if (rb !== null) {
      return 1;
    }
    return a.index - b.index; // stable tiebreak
  });

  const ordered = decorated.map((entry) => entry.view);
  return options.limit !== undefined ? ordered.slice(0, options.limit) : ordered;
}

/**
 * Presentation mapping for the strip's readiness chip (discovery mock's quiet
 * "Needs setup" badge, tone = status only, no left-border/edge treatment).
 * `null` when the workflow is ready — the chip only appears on cards with a
 * missing integration (honesty rule).
 */
export function readinessChipLabel(readiness: IntegrationReadiness): string | null {
  return readiness.ready ? null : "Needs setup";
}

// --- Composer door: chat-origin target + current-session candidate ------------

/** One bindable session, in the same shape a picker row renders (id/title/
 * harness) plus the workspace it lives on — the key `isBindableSessionCandidate`
 * matches against the run's target (B8/L29: "session belongs to the target
 * workspace"). */
export interface WorkflowSessionCandidateInput {
  id: string;
  title: string;
  harness: string;
  /** The workspace the session lives on, in whatever id space the caller's
   * session list uses — matched against the slot's resolved target verbatim
   * (no normalization here; callers keep both sides in one id space). */
  workspaceId?: string | null;
  lastActiveLabel?: string;
  heldByLabel?: string | null;
}

/** The chat composer's own session (spec: "the current session appears as a
 * binding candidate for the matching agent slot"). */
export interface ChatOriginSession {
  sessionId: string;
  title: string;
  harness: string;
  workspaceId: string | null;
}

/**
 * Chat-origin launches list the current session first among same-harness
 * bind candidates (R1 door 3). Pure merge so the composer door and any other
 * caller agree on ordering/dedup without forking the candidate list — a
 * `current` session already present in `candidates` is replaced (its slot
 * moves to the front) rather than duplicated.
 */
export function withCurrentSessionCandidate(
  candidates: readonly WorkflowSessionCandidateInput[],
  current: ChatOriginSession | null,
): WorkflowSessionCandidateInput[] {
  if (!current) {
    return [...candidates];
  }
  const currentCandidate: WorkflowSessionCandidateInput = {
    id: current.sessionId,
    title: current.title,
    harness: current.harness,
    workspaceId: current.workspaceId,
  };
  const rest = candidates.filter((candidate) => candidate.id !== current.sessionId);
  return [currentCandidate, ...rest];
}

/**
 * Chat-origin target always wins over the remembered last-used target: per
 * spec, "chat origin: implicit — the workspace the composer lives in; no
 * picker row rendered." `chatOrigin` is only non-null when the launch door
 * is the in-composer lightning bolt (R1 door 1); every other door passes
 * `null` and falls through to R6 last-used.
 */
export function resolveChatOriginTarget(
  chatOrigin: LastUsedTarget | null,
  lastUsed: LastUsedTarget | null,
): LastUsedTarget | null {
  return chatOrigin ?? lastUsed;
}

/** A slot's resolved bind target: the harness it requires plus the run's
 * target workspace, in the same id space as candidates' `workspaceId`. */
export interface BindableSlotContext {
  harness: string;
  workspaceKey: string | null;
}

/**
 * Bind-existing eligibility (gap②, B8/L29 CONTRACT: "session belongs to the
 * target workspace, harness matches the slot, session not already held").
 * Mirrors the harness + workspace half of that rule client-side so the
 * picker never offers a session StartRun would reject; held-state is
 * enforced server-side only (no client read for it exists yet).
 */
export function isBindableSessionCandidate(
  candidate: Pick<WorkflowSessionCandidateInput, "harness" | "workspaceId">,
  slot: BindableSlotContext,
): boolean {
  if (candidate.harness !== slot.harness) {
    return false;
  }
  if (slot.workspaceKey === null) {
    return false;
  }
  return (candidate.workspaceId ?? null) === slot.workspaceKey;
}
