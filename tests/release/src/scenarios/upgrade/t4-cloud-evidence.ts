import assert from "node:assert/strict";

export const QUALIFICATION_MCP_BINDING_ID = "internal:subagents";
export const QUALIFICATION_MCP_SERVER = "subagents";
export const QUALIFICATION_MCP_TOOL = "mcp__subagents__list_subagents";

export interface CatalogArtifactPin {
  version: string;
  source?: unknown;
  sha256?: string | null;
  [key: string]: unknown;
}

export interface QualificationCatalogAgent {
  kind: string;
  harness: {
    native?: CatalogArtifactPin | null;
    agentProcess: CatalogArtifactPin;
  };
}

export interface QualificationCatalogDocument {
  catalogVersion: string;
  probedAgainst?: { registryVersion?: string | null } | null;
  agents: QualificationCatalogAgent[];
}

export interface RuntimeLaunchOption {
  kind: string;
  defaultModelId?: string | null;
  models: Array<{ id: string }>;
}

export interface RuntimeLaunchOptions {
  agents: RuntimeLaunchOption[];
}

export interface QualificationAgent {
  kind: string;
  modelId: string;
  expectedNativeVersion?: string;
  expectedAgentProcessVersion: string;
}

export interface RuntimeArtifactStatus {
  installed: boolean;
  version?: string | null;
  path?: string | null;
}

export interface RuntimeAgentSummary {
  kind: string;
  installState: string;
  readiness: string;
  native?: RuntimeArtifactStatus | null;
  agentProcess?: RuntimeArtifactStatus | null;
}

export interface RuntimeReconcileResult {
  kind: string;
  outcome: string;
  message?: string | null;
}

export interface RuntimeReconcileStatus {
  status: string;
  jobId?: string | null;
  results: RuntimeReconcileResult[];
  message?: string | null;
}

export interface RuntimeMcpBindingSummary {
  id: string;
  serverName: string;
  transport: string;
  outcome: string;
  reason?: string | null;
}

export interface RuntimeSessionSummary {
  id: string;
  workspaceId: string;
  agentKind: string;
  nativeSessionId?: string | null;
  status: string;
  mcpBindingSummaries?: RuntimeMcpBindingSummary[] | null;
  executionSummary?: {
    phase?: string;
    hasLiveHandle?: boolean;
  } | null;
}

export interface RuntimeSessionEventEnvelope {
  sessionId: string;
  seq: number;
  turnId?: string | null;
  event: {
    type: string;
    stopReason?: string;
    message?: string;
    item?: {
      kind?: string;
      status?: string;
      toolCallId?: string | null;
      nativeToolName?: string | null;
      rawOutput?: unknown;
    };
  };
}

export interface TerminalTurnEvidence {
  turnId: string;
  terminalSeq: number;
  toolSeq?: number;
}

/**
 * Binds the server's catalog feed to the candidate checkout. Versions for
 * every supported agent are compared so selecting one runnable harness later
 * cannot hide a stale or partially deployed catalog.
 */
export function assertServedCatalogMatchesCandidate(
  candidate: QualificationCatalogDocument,
  served: QualificationCatalogDocument,
): void {
  assert.ok(candidate.catalogVersion.trim(), "candidate catalogVersion must be non-empty");
  assert.equal(
    served.catalogVersion,
    candidate.catalogVersion,
    `served catalog ${served.catalogVersion} does not match candidate catalog ${candidate.catalogVersion}`,
  );
  assert.equal(
    served.probedAgainst?.registryVersion ?? null,
    candidate.probedAgainst?.registryVersion ?? null,
    "served catalog was not probed against the candidate registry version",
  );

  const candidatePins = catalogPinMap(candidate);
  const servedPins = catalogPinMap(served);
  assert.deepEqual(servedPins, candidatePins, "served agent artifact pins do not match the candidate catalog");
}

/** Selects one runnable, cheap qualification harness while respecting --agents. */
export function selectQualificationAgent(
  requestedAgents: readonly string[],
  launchOptions: RuntimeLaunchOptions,
  catalog: QualificationCatalogDocument,
): QualificationAgent {
  const requested = requestedAgents.includes("all") ? undefined : new Set(requestedAgents);
  const preference = ["claude", "codex", "opencode", "grok", "cursor"];
  const launchKinds = new Map(launchOptions.agents.map((entry) => [entry.kind, entry]));
  const catalogKinds = new Map(catalog.agents.map((entry) => [entry.kind, entry]));
  const candidateKinds = [...new Set([...preference, ...launchKinds.keys()])];

  for (const kind of candidateKinds) {
    if (requested && !requested.has(kind)) {
      continue;
    }
    const launch = launchKinds.get(kind);
    const catalogAgent = catalogKinds.get(kind);
    if (!launch || !catalogAgent) {
      continue;
    }
    const modelId = selectCheapModel(launch);
    const agentProcessVersion = catalogAgent.harness.agentProcess?.version?.trim();
    if (!modelId || !agentProcessVersion) {
      continue;
    }
    const nativeVersion = catalogAgent.harness.native?.version?.trim() || undefined;
    return {
      kind,
      modelId,
      expectedNativeVersion: nativeVersion,
      expectedAgentProcessVersion: agentProcessVersion,
    };
  }

  const selector = requested ? [...requested].join(",") : "all";
  throw new Error(
    `no runnable cheap qualification agent matched --agents=${selector}; ` +
      `runtime launch options were ${[...launchKinds.keys()].join(",") || "empty"}`,
  );
}

/** Proves the managed native CLI and ACP-facing agent process match the lockfile. */
export function assertAgentArtifactsMatchPins(
  summary: RuntimeAgentSummary,
  expected: QualificationAgent,
): void {
  assert.equal(summary.kind, expected.kind, "agent summary kind changed");
  assert.equal(summary.installState, "installed", `${expected.kind} is not installed`);
  assert.equal(summary.readiness, "ready", `${expected.kind} is not ready`);
  assertArtifact(summary.agentProcess, expected.expectedAgentProcessVersion, `${expected.kind} agent-process adapter`);
  if (expected.expectedNativeVersion) {
    assertArtifact(summary.native, expected.expectedNativeVersion, `${expected.kind} native CLI`);
  }
}

/** Startup reconcile must account for the installed qualification harness. */
export function assertReconcileCompletedForAgent(
  status: RuntimeReconcileStatus,
  expectedAgentKind: string,
): void {
  assert.equal(
    status.status,
    "completed",
    `agent reconcile is ${status.status}${status.message ? `: ${status.message}` : ""}`,
  );
  assert.ok(status.jobId, "agent reconcile completed without a job id");
  const result = status.results.find((entry) => entry.kind === expectedAgentKind);
  assert.ok(result, `agent reconcile did not report ${expectedAgentKind}`);
  assert.ok(
    result.outcome === "installed" || result.outcome === "already_installed",
    `agent reconcile did not converge ${expectedAgentKind}: ${result.outcome}${
      result.message ? ` (${result.message})` : ""
    }`,
  );
}

/** The persisted session must expose the exact product MCP adapter as applied. */
export function assertQualificationMcpApplied(session: RuntimeSessionSummary): void {
  const summary = session.mcpBindingSummaries?.find((entry) => entry.id === QUALIFICATION_MCP_BINDING_ID);
  assert.ok(summary, `${QUALIFICATION_MCP_BINDING_ID} binding summary is missing`);
  assert.equal(summary.serverName, QUALIFICATION_MCP_SERVER, "wrong qualification MCP server was attached");
  assert.equal(summary.transport, "http", "qualification MCP transport changed");
  assert.equal(
    summary.outcome,
    "applied",
    `qualification MCP was not applied${summary.reason ? `: ${summary.reason}` : ""}`,
  );
  assert.equal(summary.reason ?? null, null, "applied qualification MCP unexpectedly carries a failure reason");
}

/** Durable identity, workspace, and harness must survive the runtime process swap. */
export function assertSameDurableSession(
  before: RuntimeSessionSummary,
  after: RuntimeSessionSummary,
): void {
  assert.equal(after.id, before.id, "runtime update replaced the durable session id");
  assert.equal(after.workspaceId, before.workspaceId, "runtime update moved the session to another workspace");
  assert.equal(after.agentKind, before.agentKind, "runtime update changed the session harness");
}

export function maxEventSeq(events: readonly RuntimeSessionEventEnvelope[]): number {
  return events.reduce((max, entry) => Math.max(max, entry.seq), 0);
}

/**
 * Structured terminal evidence for one post-baseline turn. When a tool name is
 * supplied, the tool must have completed in the same turn that ended cleanly.
 */
export function assertTerminalTurnEvidence(
  events: readonly RuntimeSessionEventEnvelope[],
  afterSeq: number,
  expectedNativeToolName?: string,
): TerminalTurnEvidence {
  assertStrictlyIncreasing(events);
  const postBaseline = events.filter((entry) => entry.seq > afterSeq);
  assert.ok(postBaseline.length > 0, `no session events were recorded after seq ${afterSeq}`);

  const error = postBaseline.find((entry) => entry.event.type === "error");
  assert.equal(
    error,
    undefined,
    `session emitted an error after update: ${error?.event.message ?? "unknown error"}`,
  );

  let toolEvent: RuntimeSessionEventEnvelope | undefined;
  if (expectedNativeToolName) {
    toolEvent = postBaseline.find(
      (entry) =>
        entry.event.type === "item_completed" &&
        entry.event.item?.kind === "tool_invocation" &&
        entry.event.item.status === "completed" &&
        entry.event.item.nativeToolName === expectedNativeToolName &&
        Boolean(entry.event.item.toolCallId),
    );
    assert.ok(
      toolEvent,
      `no completed structured tool invocation for ${expectedNativeToolName} was recorded after seq ${afterSeq}`,
    );
    assert.ok(toolEvent.turnId, `${expectedNativeToolName} tool event is missing its turn id`);
  }

  const terminal = postBaseline.find(
    (entry) =>
      entry.event.type === "turn_ended" &&
      entry.event.stopReason === "end_turn" &&
      (!toolEvent || entry.turnId === toolEvent.turnId),
  );
  assert.ok(terminal, "post-update turn did not end successfully with stopReason=end_turn");
  assert.ok(terminal.turnId, "terminal turn event is missing its turn id");
  if (toolEvent) {
    assert.ok(terminal.seq > toolEvent.seq, "turn ended before the MCP tool invocation completed");
  }
  return {
    turnId: terminal.turnId,
    terminalSeq: terminal.seq,
    toolSeq: toolEvent?.seq,
  };
}

function catalogPinMap(catalog: QualificationCatalogDocument): Record<string, unknown> {
  return Object.fromEntries(
    [...catalog.agents]
      .sort((left, right) => left.kind.localeCompare(right.kind))
      .map((entry) => [
        entry.kind,
        {
          native: entry.harness.native ?? null,
          agentProcess: entry.harness.agentProcess ?? null,
        },
      ]),
  );
}

function selectCheapModel(launch: RuntimeLaunchOption): string | undefined {
  const allowed = launch.models
    .map((model) => model.id.trim())
    .filter((id) => id.length > 0 && !/fable|opus/i.test(id));
  if (allowed.length === 0) {
    return undefined;
  }
  const ranked = [...allowed].sort((left, right) => modelCostRank(left) - modelCostRank(right));
  const preferred = ranked[0];
  if (preferred) {
    return preferred;
  }
  const defaultModel = launch.defaultModelId?.trim();
  return defaultModel && allowed.includes(defaultModel) ? defaultModel : undefined;
}

function modelCostRank(modelId: string): number {
  if (/haiku|mini|nano/i.test(modelId)) return 0;
  if (/sonnet/i.test(modelId)) return 1;
  if (/default/i.test(modelId)) return 2;
  return 3;
}

function assertArtifact(
  artifact: RuntimeArtifactStatus | null | undefined,
  expectedVersion: string,
  label: string,
): void {
  assert.ok(artifact, `${label} status is missing`);
  assert.equal(artifact.installed, true, `${label} is not installed`);
  assert.equal(artifact.version?.trim(), expectedVersion, `${label} version does not match the candidate pin`);
  assert.ok(artifact.path?.trim(), `${label} does not expose an installed path`);
}

function assertStrictlyIncreasing(events: readonly RuntimeSessionEventEnvelope[]): void {
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(
      events[index].seq > events[index - 1].seq,
      `session event sequence is not strictly increasing at ${events[index - 1].seq} -> ${events[index].seq}`,
    );
    assert.equal(events[index].sessionId, events[0].sessionId, "event page contains multiple session ids");
  }
}
