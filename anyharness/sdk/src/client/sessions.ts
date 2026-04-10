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
import { normalizeSessionEventEnvelope } from "../types/events.js";
import {
  normalizeSession,
  normalizeSessionLiveConfigSnapshot,
} from "../types/sessions.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

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
      await this.transport.get<Session[]>(`/v1/sessions${query}`, options)
    ).map(normalizeSession);
  }

  async get(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session> {
    return normalizeSession(await this.transport.get<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      options,
    ));
  }

  async updateTitle(
    sessionId: string,
    input: UpdateSessionTitleRequest,
  ): Promise<Session> {
    return normalizeSession(await this.transport.patch<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/title`,
      input,
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

  async resume(sessionId: string, options?: AnyHarnessRequestOptions): Promise<Session> {
    return normalizeSession(await this.transport.post<Session>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/resume`,
      {},
      options,
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
    const query = options?.afterSeq != null
      ? `?after_seq=${encodeURIComponent(String(options.afterSeq))}`
      : "";
    const envelopes = await this.transport.get<SessionEventEnvelope[]>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/events${query}`,
      options?.request,
    );
    return envelopes.map(normalizeSessionEventEnvelope);
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
