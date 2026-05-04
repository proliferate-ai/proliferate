import type {
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "../types/events.js";
import type {
  CreateSessionRequest,
  EditPendingPromptRequest,
  ForkSessionRequest,
  ForkSessionResponse,
  GetSessionLiveConfigResponse,
  ListSessionEventsOptions,
  McpElicitationUrlRevealResponse,
  PromptSessionRequest,
  PromptSessionResponse,
  ResolveInteractionRequest,
  ResumeSessionRequest,
  ScheduleSubagentWakeRequest,
  ScheduleSubagentWakeResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  Session,
  SessionSubagentsResponse,
  UpdateSessionTitleRequest,
} from "../types/sessions.js";
import { normalizeSessionEventEnvelope } from "../types/events.js";
import {
  normalizeForkSessionResponse,
  normalizeSession,
  normalizeSessionLiveConfigSnapshot,
} from "../types/sessions.js";
import { withTimingCategory, type AnyHarnessRequestOptions, type AnyHarnessTransport } from "./core.js";

export class SessionsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async create(input: CreateSessionRequest, options?: AnyHarnessRequestOptions): Promise<Session> {
    return normalizeSession(
      await this.transport.post<Session>("/v1/sessions", input, options),
    );
  }

  async list(
    workspaceId?: string,
    options?: AnyHarnessRequestOptions & { includeDismissed?: boolean },
  ): Promise<Session[]> {
    const params = new URLSearchParams();
    if (workspaceId) {
      params.set("workspace_id", workspaceId);
    }
    if (options?.includeDismissed) {
      params.set("include_dismissed", "true");
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return (
      await this.transport.get<Session[]>(
        `/v1/sessions${query}`,
        withTimingCategory(options, "session.list"),
      )
    ).map(normalizeSession);
  }

  async get(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session> {
    return normalizeSession(await this.transport.get<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      options,
    ));
  }

  async getSubagents(
    sessionId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<SessionSubagentsResponse> {
    return this.transport.get<SessionSubagentsResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/subagents`,
      options,
    );
  }

  async scheduleSubagentWake(
    sessionId: string,
    childSessionId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<ScheduleSubagentWakeResponse> {
    const request: ScheduleSubagentWakeRequest = {};
    return this.transport.post<ScheduleSubagentWakeResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/subagents/${
        encodeURIComponent(childSessionId)
      }/wake`,
      request,
      options,
    );
  }

  async updateTitle(
    sessionId: string,
    input: UpdateSessionTitleRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<Session> {
    return normalizeSession(await this.transport.patch<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/title`,
      input,
      withTimingCategory(options, "session.title.update"),
    ));
  }

  async getLiveConfig(
    sessionId: string,
  ): Promise<GetSessionLiveConfigResponse> {
    const response = await this.transport.get<GetSessionLiveConfigResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/live-config`,
    );
    if (!response.liveConfig) {
      return response;
    }
    return {
      ...response,
      liveConfig: normalizeSessionLiveConfigSnapshot(response.liveConfig),
    };
  }

  async setConfigOption(
    sessionId: string,
    input: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const response = await this.transport.post<SetSessionConfigOptionResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/config-options`,
      input,
    );
    if (!response.liveConfig) {
      return {
        ...response,
        session: normalizeSession(response.session),
      };
    }
    return {
      ...response,
      liveConfig: normalizeSessionLiveConfigSnapshot(response.liveConfig),
      session: normalizeSession(response.session),
    };
  }

  async prompt(
    sessionId: string,
    input: PromptSessionRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<PromptSessionResponse> {
    const response = await this.transport.post<PromptSessionResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/prompt`,
      input,
      options,
    );
    return {
      ...response,
      session: normalizeSession(response.session),
    };
  }

  async promptText(
    sessionId: string,
    text: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<PromptSessionResponse> {
    return this.prompt(sessionId, {
      blocks: [{ type: "text", text }],
    }, options);
  }

  async fork(
    sessionId: string,
    input: ForkSessionRequest = {},
    options?: AnyHarnessRequestOptions,
  ): Promise<ForkSessionResponse> {
    return normalizeForkSessionResponse(
      await this.transport.post<ForkSessionResponse>(
        `/v1/sessions/${encodeURIComponent(sessionId)}/fork`,
        input,
        options,
      ),
    );
  }

  async fetchPromptAttachment(
    sessionId: string,
    attachmentId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<Blob> {
    return this.transport.getBlob(
      `/v1/sessions/${encodeURIComponent(sessionId)}/prompt-attachments/${encodeURIComponent(attachmentId)}`,
      options,
    );
  }

  async editPendingPrompt(
    sessionId: string,
    seq: number,
    input: EditPendingPromptRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<Session> {
    return normalizeSession(
      await this.transport.patch<Session>(
        `/v1/sessions/${encodeURIComponent(sessionId)}/pending-prompts/${encodeURIComponent(String(seq))}`,
        input,
        options,
      ),
    );
  }

  async deletePendingPrompt(
    sessionId: string,
    seq: number,
    options?: AnyHarnessRequestOptions,
  ): Promise<Session> {
    return normalizeSession(
      await this.transport.deleteJson<Session>(
        `/v1/sessions/${encodeURIComponent(sessionId)}/pending-prompts/${encodeURIComponent(String(seq))}`,
        options,
      ),
    );
  }

  async resume(sessionId: string): Promise<Session>;
  async resume(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session>;
  async resume(
    sessionId: string,
    input: ResumeSessionRequest | undefined,
    options?: AnyHarnessRequestOptions,
  ): Promise<Session>;
  async resume(
    sessionId: string,
    inputOrOptions?: ResumeSessionRequest | AnyHarnessRequestOptions,
    options?: AnyHarnessRequestOptions,
  ): Promise<Session> {
    const input = isResumeRequestOptions(inputOrOptions) ? undefined : inputOrOptions;
    const requestOptions = isResumeRequestOptions(inputOrOptions) ? inputOrOptions : options;
    return normalizeSession(await this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/resume`,
      input ?? {},
      requestOptions,
    ));
  }

  async cancel(sessionId: string): Promise<Session> {
    return normalizeSession(await this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
      {},
    ));
  }

  async dismiss(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session> {
    return normalizeSession(await this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/dismiss`,
      {},
      options,
    ));
  }

  async close(sessionId: string): Promise<Session> {
    return normalizeSession(await this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/close`,
      {},
    ));
  }

  async restoreDismissed(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<Session | null> {
    const session = await this.transport.post<Session | null>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions/restore`,
      {},
      options,
    );
    return session ? normalizeSession(session) : null;
  }

  async listEvents(
    sessionId: string,
    options?: ListSessionEventsOptions & { request?: AnyHarnessRequestOptions },
  ): Promise<SessionEventEnvelope[]> {
    const params = new URLSearchParams();
    if (options?.afterSeq != null) {
      params.set("after_seq", String(options.afterSeq));
    }
    if (options?.beforeSeq != null) {
      params.set("before_seq", String(options.beforeSeq));
    }
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.turnLimit != null) {
      params.set("turn_limit", String(options.turnLimit));
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    const envelopes = await this.transport.get<SessionEventEnvelope[]>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/events${query}`,
      withTimingCategory(options?.request, "session.events.list"),
    );
    return envelopes.map(normalizeSessionEventEnvelope);
  }

  async listRawNotifications(
    sessionId: string,
    options?: ListSessionEventsOptions,
  ): Promise<SessionRawNotificationEnvelope[]> {
    const params = new URLSearchParams();
    if (options?.afterSeq != null) {
      params.set("after_seq", String(options.afterSeq));
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return this.transport.get<SessionRawNotificationEnvelope[]>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/raw-notifications${query}`,
    );
  }

  async resolveInteraction(
    sessionId: string,
    requestId: string,
    input: ResolveInteractionRequest,
  ): Promise<void> {
    await this.transport.post<void>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/interactions/${encodeURIComponent(requestId)}/resolve`,
      input,
    );
  }

  async revealMcpElicitationUrl(
    sessionId: string,
    requestId: string,
  ): Promise<McpElicitationUrlRevealResponse> {
    return this.transport.post<McpElicitationUrlRevealResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/interactions/${encodeURIComponent(requestId)}/mcp-url/reveal`,
      {},
    );
  }
}

function isResumeRequestOptions(
  value: ResumeSessionRequest | AnyHarnessRequestOptions | undefined,
): value is AnyHarnessRequestOptions {
  return Boolean(
    value
    && (
      "headers" in value
      || "measurementOperationId" in value
      || "timingCategory" in value
      || "timingScope" in value
    )
    && !("mcpServers" in value)
    && !("mcpBindingSummaries" in value),
  );
}
