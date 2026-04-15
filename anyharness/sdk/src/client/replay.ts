import type {
  AdvanceReplaySessionResponse,
  CreateReplaySessionRequest,
  CreateReplaySessionResponse,
  ExportReplayRecordingRequest,
  ExportReplayRecordingResponse,
  ListReplayRecordingsResponse,
} from "../types/replay.js";
import { normalizeSession } from "../types/sessions.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class ReplayClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async listRecordings(
    options?: AnyHarnessRequestOptions,
  ): Promise<ListReplayRecordingsResponse> {
    return this.transport.get<ListReplayRecordingsResponse>(
      "/v1/replay/recordings",
      options,
    );
  }

  async exportRecording(
    input: ExportReplayRecordingRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<ExportReplayRecordingResponse> {
    return this.transport.post<ExportReplayRecordingResponse>(
      "/v1/replay/recordings",
      input,
      options,
    );
  }

  async createSession(
    input: CreateReplaySessionRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<CreateReplaySessionResponse> {
    const response = await this.transport.post<CreateReplaySessionResponse>(
      "/v1/replay/sessions",
      input,
      options,
    );
    return {
      ...response,
      session: normalizeSession(response.session),
    };
  }

  async advanceSession(
    sessionId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<AdvanceReplaySessionResponse> {
    return this.transport.post<AdvanceReplaySessionResponse>(
      `/v1/replay/sessions/${encodeURIComponent(sessionId)}/advance`,
      {},
      options,
    );
  }
}
