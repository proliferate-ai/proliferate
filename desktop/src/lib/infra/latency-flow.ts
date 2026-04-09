import { elapsedSince, logLatency } from "./debug-latency";

export type LatencyFlowKind =
  | "prompt_submit"
  | "session_create"
  | "session_restore"
  | "session_switch"
  | "workspace_switch"
  | "worktree_enter";

export type LatencyFlowStage =
  | "intent"
  | "optimistic_visible"
  | "processing_started"
  | "surface_ready"
  | "live_attached"
  | "failed"
  | "cancelled";

export interface StartLatencyFlowInput {
  flowKind: LatencyFlowKind;
  source?: string | null;
  targetWorkspaceId?: string | null;
  targetSessionId?: string | null;
  attemptId?: string | null;
  promptId?: string | null;
}

export interface AnnotateLatencyFlowInput {
  source?: string | null;
  targetWorkspaceId?: string | null;
  targetSessionId?: string | null;
  attemptId?: string | null;
  promptId?: string | null;
}

export interface LatencyFlowRecord {
  flowId: string;
  flowKind: LatencyFlowKind;
  startedAt: number;
  source: string | null;
  targetWorkspaceId: string | null;
  targetSessionId: string | null;
  attemptId: string | null;
  promptId: string | null;
  completedStages: ReadonlySet<LatencyFlowStage>;
}

interface MutableLatencyFlowRecord extends Omit<LatencyFlowRecord, "completedStages"> {
  completedStages: Set<LatencyFlowStage>;
}

interface FinishLatencyFlowOptions {
  keepActive?: boolean;
  reason?: string | null;
  extraFields?: Record<string, unknown>;
}

const FLOW_MAX_AGE_MS = 5 * 60 * 1000;
const activeFlows = new Map<string, MutableLatencyFlowRecord>();

function createFlowId(flowKind: LatencyFlowKind): string {
  return `${flowKind}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function toRecord(flow: MutableLatencyFlowRecord): LatencyFlowRecord {
  return {
    ...flow,
    completedStages: new Set(flow.completedStages),
  };
}

function logFlowStage(
  flow: MutableLatencyFlowRecord,
  stage: LatencyFlowStage,
  options?: FinishLatencyFlowOptions,
): void {
  logLatency(`flow.${flow.flowKind}.${stage}`, {
    flowId: flow.flowId,
    flowKind: flow.flowKind,
    stage,
    source: flow.source,
    targetWorkspaceId: flow.targetWorkspaceId,
    targetSessionId: flow.targetSessionId,
    attemptId: flow.attemptId,
    promptId: flow.promptId,
    elapsedMs: elapsedSince(flow.startedAt),
    reason: options?.reason ?? null,
    ...options?.extraFields,
  });
}

function shouldKeepFlowActive(
  flow: MutableLatencyFlowRecord,
  stage: LatencyFlowStage,
  keepActive: boolean | undefined,
): boolean {
  if (keepActive !== undefined) {
    return keepActive;
  }

  if (stage === "optimistic_visible") {
    return true;
  }

  if (flow.flowKind === "prompt_submit") {
    return false;
  }

  if (stage === "surface_ready") {
    return flow.targetSessionId !== null && !flow.completedStages.has("live_attached");
  }

  if (stage === "live_attached") {
    return !flow.completedStages.has("surface_ready");
  }

  return false;
}

export function pruneLatencyFlows(now = Date.now()): void {
  for (const flow of activeFlows.values()) {
    if (now - flow.startedAt <= FLOW_MAX_AGE_MS) {
      continue;
    }

    logFlowStage(flow, "cancelled", {
      reason: "stale",
    });
    activeFlows.delete(flow.flowId);
  }
}

export function startLatencyFlow(input: StartLatencyFlowInput): string {
  pruneLatencyFlows();

  const flowId = createFlowId(input.flowKind);
  const flow: MutableLatencyFlowRecord = {
    flowId,
    flowKind: input.flowKind,
    startedAt: Date.now(),
    source: input.source ?? null,
    targetWorkspaceId: input.targetWorkspaceId ?? null,
    targetSessionId: input.targetSessionId ?? null,
    attemptId: input.attemptId ?? null,
    promptId: input.promptId ?? null,
    completedStages: new Set(["intent"]),
  };
  activeFlows.set(flowId, flow);
  logFlowStage(flow, "intent");
  return flowId;
}

export function annotateLatencyFlow(
  flowId: string | null | undefined,
  input: AnnotateLatencyFlowInput,
): void {
  if (!flowId) {
    return;
  }

  const flow = activeFlows.get(flowId);
  if (!flow) {
    return;
  }

  if (input.source !== undefined) {
    flow.source = input.source;
  }
  if (input.targetWorkspaceId !== undefined) {
    flow.targetWorkspaceId = input.targetWorkspaceId;
  }
  if (input.targetSessionId !== undefined) {
    flow.targetSessionId = input.targetSessionId;
  }
  if (input.attemptId !== undefined) {
    flow.attemptId = input.attemptId;
  }
  if (input.promptId !== undefined) {
    flow.promptId = input.promptId;
  }
}

export function finishLatencyFlow(
  flowId: string | null | undefined,
  stage: Exclude<LatencyFlowStage, "intent" | "failed" | "cancelled">,
  options?: FinishLatencyFlowOptions,
): boolean {
  if (!flowId) {
    return false;
  }

  const flow = activeFlows.get(flowId);
  if (!flow || flow.completedStages.has(stage)) {
    return false;
  }

  flow.completedStages.add(stage);
  logFlowStage(flow, stage, options);
  if (!shouldKeepFlowActive(flow, stage, options?.keepActive)) {
    activeFlows.delete(flowId);
  }
  return true;
}

export function failLatencyFlow(
  flowId: string | null | undefined,
  reason: string,
  extraFields?: Record<string, unknown>,
): void {
  if (!flowId) {
    return;
  }

  const flow = activeFlows.get(flowId);
  if (!flow) {
    return;
  }

  flow.completedStages.add("failed");
  logFlowStage(flow, "failed", {
    reason,
    extraFields,
  });
  activeFlows.delete(flowId);
}

export function cancelLatencyFlow(
  flowId: string | null | undefined,
  reason: string,
  extraFields?: Record<string, unknown>,
): void {
  if (!flowId) {
    return;
  }

  const flow = activeFlows.get(flowId);
  if (!flow) {
    return;
  }

  flow.completedStages.add("cancelled");
  logFlowStage(flow, "cancelled", {
    reason,
    extraFields,
  });
  activeFlows.delete(flowId);
}

export function listActiveLatencyFlows(): LatencyFlowRecord[] {
  pruneLatencyFlows();
  return Array.from(activeFlows.values(), toRecord);
}

export function getLatencyFlowRequestHeaders(
  flowId: string | null | undefined,
): HeadersInit | undefined {
  if (!flowId) {
    return undefined;
  }

  const flow = activeFlows.get(flowId);
  if (!flow) {
    return undefined;
  }

  const headers: Record<string, string> = {
    "x-anyharness-flow-id": flow.flowId,
    "x-anyharness-flow-kind": flow.flowKind,
  };
  if (flow.source) {
    headers["x-anyharness-flow-source"] = flow.source;
  }
  if (flow.promptId) {
    headers["x-anyharness-prompt-id"] = flow.promptId;
  }
  return headers;
}

export function markLatencyFlowLiveAttached(sessionId: string): void {
  for (const flow of activeFlows.values()) {
    if (flow.flowKind === "prompt_submit" || flow.targetSessionId !== sessionId) {
      continue;
    }
    finishLatencyFlow(flow.flowId, "live_attached");
  }
}

export function resetLatencyFlowsForTest(): void {
  activeFlows.clear();
}
