import type {
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "../types/events.js";
import type {
  CreateSessionRequest,
  GetSessionLiveConfigResponse,
  ListSessionEventsOptions,
  PromptSessionRequest,
  PromptSessionResponse,
  ResolvePermissionRequest,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  Session,
  UpdateSessionTitleRequest,
} from "../types/sessions.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class SessionsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async create(input: CreateSessionRequest, options?: AnyHarnessRequestOptions): Promise<Session> {
    return this.transport.post<Session>("/v1/sessions", input, options);
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
    return this.transport.get<Session[]>(`/v1/sessions${query}`, options);
  }

  async get(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session> {
    return this.transport.get<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      options,
    );
  }

  async updateTitle(
    sessionId: string,
    input: UpdateSessionTitleRequest,
  ): Promise<Session> {
    return this.transport.patch<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/title`,
      input,
    );
  }

  async getLiveConfig(
    sessionId: string,
  ): Promise<GetSessionLiveConfigResponse> {
    return this.transport.get<GetSessionLiveConfigResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/live-config`,
    );
  }

  async setConfigOption(
    sessionId: string,
    input: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    return this.transport.post<SetSessionConfigOptionResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/config-options`,
      input,
    );
  }

  async prompt(
    sessionId: string,
    input: PromptSessionRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<PromptSessionResponse> {
    return this.transport.post<PromptSessionResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/prompt`,
      input,
      options,
    );
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

  async resume(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session> {
    return this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/resume`,
      {},
      options,
    );
  }

  async cancel(sessionId: string): Promise<Session> {
    return this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
      {},
    );
  }

  async dismiss(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session> {
    return this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/dismiss`,
      {},
      options,
    );
  }

  async close(sessionId: string): Promise<Session> {
    return this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/close`,
      {},
    );
  }

  async restoreDismissed(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<Session | null> {
    return this.transport.post<Session | null>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions/restore`,
      {},
      options,
    );
  }

  async listEvents(
    sessionId: string,
    options?: ListSessionEventsOptions & { request?: AnyHarnessRequestOptions },
  ): Promise<SessionEventEnvelope[]> {
    const query = options?.afterSeq != null
      ? `?after_seq=${encodeURIComponent(String(options.afterSeq))}`
      : "";
    return this.transport.get<SessionEventEnvelope[]>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/events${query}`,
      options?.request,
    );
  }

  async listRawNotifications(
    sessionId: string,
    options?: ListSessionEventsOptions,
  ): Promise<SessionRawNotificationEnvelope[]> {
    const query = options?.afterSeq != null
      ? `?after_seq=${encodeURIComponent(String(options.afterSeq))}`
      : "";
    return this.transport.get<SessionRawNotificationEnvelope[]>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/raw-notifications${query}`,
    );
  }

  async resolvePermission(
    sessionId: string,
    requestId: string,
    input: ResolvePermissionRequest,
  ): Promise<void> {
    await this.transport.post<void>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/resolve`,
      input,
    );
  }
}
