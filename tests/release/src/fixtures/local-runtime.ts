/**
 * Thin client for the local AnyHarness runtime's own HTTP API
 * (`anyharness/crates/anyharness-lib/src/api/router.rs`) — the same API a
 * cloud sandbox exposes, just reached directly on `127.0.0.1` instead of
 * through the Python server's `/v1/gateway/cloud-sandbox/anyharness/*` proxy
 * (server/proliferate/server/cloud/gateway/api.py; verified for real
 * 2026-07-09 -- `/v1/cloud/cloud-sandbox/anyharness/*` 404s, see
 * `../fixtures/cloud-sandbox.ts`).
 *
 * Local-lane scenarios use this instead of the Python server for anything
 * workspace/session/agent-shaped: per the survey behind this runner (see
 * `mintFreshUser`'s neighbor `GITHUB_LINK_GATE_WORKAROUND_ACTIVE`), desktop's
 * local worktree-creation call is desktop-mediated, not server-mediated —
 * confirmed empirically against a running `t3local` profile 2026-07-08 (no
 * bearer token, no `current_product_user` gate; the local runtime trusts
 * whoever can reach its port, which is the whole local-dev trust model).
 *
 * Default base URL matches `apps/desktop/src/config/runtime.ts`'s
 * `VITE_ANYHARNESS_DEV_URL` default and this profile's `ANYHARNESS_PORT`.
 */

export interface LocalRuntimeClientOptions {
  baseUrl: string;
}

export class LocalRuntimeError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} -> ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "LocalRuntimeError";
    this.status = status;
    this.body = body;
  }
}

export interface RepoRoot {
  id: string;
  kind: string;
  path: string;
  defaultBranch: string | null;
  remoteProvider?: string | null;
  remoteOwner?: string | null;
  remoteRepoName?: string | null;
}

export interface Workspace {
  id: string;
  kind: "local" | "worktree" | string;
  repoRootId: string;
  path: string;
  originalBranch?: string | null;
  currentBranch?: string | null;
  lifecycleState: string;
}

export interface CreateWorkspaceResponse {
  repoRoot: RepoRoot;
  workspace: Workspace;
}

export interface CreateWorktreeWorkspaceResponse {
  workspace: Workspace;
  setupScript?: {
    command: string;
    status: "queued" | "running" | "succeeded" | "failed";
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  } | null;
}

export interface AgentArtifactStatus {
  role: string;
  installed: boolean;
  version?: string | null;
  path?: string | null;
  source?: string | null;
  message?: string | null;
}

export interface AgentSummary {
  kind: string;
  displayName: string;
  installState: string;
  nativeRequired: boolean;
  native?: AgentArtifactStatus | null;
  agentProcess?: AgentArtifactStatus | null;
  credentialState: string;
  readiness: string;
}

export interface SessionSummary {
  id: string;
  workspaceId: string;
  agentKind: string;
  modelId?: string | null;
  requestedModelId?: string | null;
  modeId?: string | null;
  status: string;
  liveConfig?: LiveSessionConfig;
}

export interface LiveConfigOption {
  key: string;
  rawConfigId: string;
  label: string;
  currentValue: string;
  settable: boolean;
  values: Array<{ value: string; label: string; description?: string }>;
}

export interface LiveSessionConfig {
  rawConfigOptions: unknown[];
  normalizedControls: Record<string, LiveConfigOption>;
  sourceSeq: number;
}

export interface SessionEventEnvelope {
  sessionId: string;
  seq: number;
  timestamp: string;
  event: { type: string } & Record<string, unknown>;
}

export class LocalRuntimeClient {
  readonly baseUrl: string;

  constructor(options: LocalRuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async listAgents(): Promise<AgentSummary[]> {
    return this.request<AgentSummary[]>("GET", "/v1/agents");
  }

  async getAgent(kind: string): Promise<AgentSummary> {
    return this.request<AgentSummary>("GET", `/v1/agents/${kind}`);
  }

  async installAgent(kind: string): Promise<AgentSummary> {
    const response = await this.request<{ agent: AgentSummary }>("POST", `/v1/agents/${kind}/install`, {});
    return response.agent;
  }

  /**
   * The runtime's probed gateway model list for a harness
   * (`GET /v1/agents/{kind}/catalog/gateway-models`) — the models the pushed
   * gateway key can actually serve, recorded by the runtime's own probe after
   * an agent-auth state push. Empty when no gateway auth is configured (a
   * native-login laptop), so callers fall back to catalog-derived candidates.
   */
  async getGatewayModels(kind: string): Promise<Array<{ id: string }>> {
    const response = await this.request<{ models: Array<{ id: string }> }>(
      "GET",
      `/v1/agents/${kind}/catalog/gateway-models`,
    );
    return response.models;
  }

  /**
   * The runtime's per-agent launch options (`GET /v1/agents/launch-options`) —
   * the exact source Desktop's composer reads for local launch. An agent only
   * appears here (with a non-empty `models` list) once its process is installed
   * and its credentials resolve, so it is the authoritative "is this harness
   * launchable in the UI yet" signal.
   */
  async getAgentLaunchOptions(): Promise<Array<{ kind: string; models: Array<{ id: string }> }>> {
    const response = await this.request<{ agents: Array<{ kind: string; models: Array<{ id: string }> }> }>(
      "GET",
      "/v1/agents/launch-options",
    );
    return response.agents;
  }

  async createLocalWorkspace(path: string): Promise<CreateWorkspaceResponse> {
    return this.request<CreateWorkspaceResponse>("POST", "/v1/workspaces", { path });
  }

  /** All workspaces the runtime currently knows about (diagnostic use). */
  async listWorkspaces(): Promise<Workspace[]> {
    const response = await this.request<{ workspaces?: Workspace[] } | Workspace[]>("GET", "/v1/workspaces");
    return Array.isArray(response) ? response : (response.workspaces ?? []);
  }

  async createWorktree(params: {
    repoRootId: string;
    targetPath: string;
    newBranchName: string;
    baseBranch?: string;
    setupScript?: string;
  }): Promise<CreateWorktreeWorkspaceResponse> {
    return this.request<CreateWorktreeWorkspaceResponse>("POST", "/v1/workspaces/worktrees", {
      repoRootId: params.repoRootId,
      targetPath: params.targetPath,
      newBranchName: params.newBranchName,
      checkoutMode: "new_branch",
      baseBranch: params.baseBranch,
      setupScript: params.setupScript,
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.request("DELETE", `/v1/workspaces/${workspaceId}`);
  }

  async createSession(params: {
    workspaceId: string;
    agentKind: string;
    modelId?: string;
  }): Promise<SessionSummary> {
    return this.request<SessionSummary>("POST", "/v1/sessions", {
      workspaceId: params.workspaceId,
      agentKind: params.agentKind,
      modelId: params.modelId,
    });
  }

  async getSession(sessionId: string): Promise<SessionSummary> {
    return this.request<SessionSummary>("GET", `/v1/sessions/${sessionId}`);
  }

  /** All sessions the runtime currently knows about (diagnostic use). */
  async listSessions(): Promise<SessionSummary[]> {
    const response = await this.request<{ sessions?: SessionSummary[] } | SessionSummary[]>("GET", "/v1/sessions");
    return Array.isArray(response) ? response : (response.sessions ?? []);
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.request("POST", `/v1/sessions/${sessionId}/prompt`, {
      blocks: [{ type: "text", text }],
    });
  }

  async getEvents(sessionId: string, limit = 200): Promise<SessionEventEnvelope[]> {
    return this.request<SessionEventEnvelope[]>("GET", `/v1/sessions/${sessionId}/events?limit=${limit}`);
  }

  async getLiveConfig(sessionId: string): Promise<LiveSessionConfig> {
    const response = await this.request<{ liveConfig: LiveSessionConfig }>(
      "GET",
      `/v1/sessions/${sessionId}/live-config`,
    );
    return response.liveConfig;
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    await this.request("POST", `/v1/sessions/${sessionId}/config-options`, { configId, value });
  }

  /**
   * Polls `GET /v1/sessions/{id}` until status leaves `running`/`Running`, or
   * `timeoutMs` elapses. Real turn completion is asserted from the event
   * stream (`turn_ended`) by callers — this just avoids a busy loop.
   */
  async waitForIdle(sessionId: string, options: { timeoutMs: number; pollMs?: number } = { timeoutMs: 60_000 }): Promise<SessionSummary> {
    const pollMs = options.pollMs ?? 1000;
    const deadline = Date.now() + options.timeoutMs;
    let last = await this.getSession(sessionId);
    while (Date.now() < deadline) {
      const status = last.status.toLowerCase();
      if (status !== "running" && status !== "starting") {
        return last;
      }
      await sleep(pollMs);
      last = await this.getSession(sessionId);
    }
    return last;
  }

  private async request<TResponse>(method: string, path: string, body?: unknown): Promise<TResponse> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text.length > 0 ? safeJsonParse(text) : undefined;
    if (!response.ok) {
      throw new LocalRuntimeError(method, path, response.status, parsed ?? text);
    }
    return parsed as TResponse;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Finds the `turn_ended` event (if any) among a session's event log. */
export function findTurnEndedEvent(events: SessionEventEnvelope[]): SessionEventEnvelope | undefined {
  return events.find((entry) => entry.event.type === "turn_ended");
}

/** Finds the last `assistant_message` item_completed event's text, if any. */
export function findLastAssistantReply(events: SessionEventEnvelope[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i].event as { type: string; item?: { kind?: string; contentParts?: Array<{ type: string; text?: string }> } };
    if (event.type === "item_completed" && event.item?.kind === "assistant_message") {
      const text = event.item.contentParts?.find((part) => part.type === "text")?.text;
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

/** Finds a session-level `error` event's message, if any (surfaces harness/model errors as a real assertion failure, not a hang). */
export function findErrorEvent(events: SessionEventEnvelope[]): string | undefined {
  const errorEvent = events.find((entry) => entry.event.type === "error");
  return errorEvent ? String((errorEvent.event as { message?: string }).message ?? "unknown error") : undefined;
}
