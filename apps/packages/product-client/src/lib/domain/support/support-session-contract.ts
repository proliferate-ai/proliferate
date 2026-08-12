export const SUPPORT_SESSION_EVIDENCE_BYTES = 8_388_608;
export const SUPPORT_SESSION_LIST_BYTES = 1_048_576;
export const SUPPORT_EVENT_LIST_BYTES = 4_194_304;
export const SUPPORT_RAW_NOTIFICATION_LIST_BYTES = 2_097_152;
export const SUPPORT_SESSION_LIMIT = 3;
export const SUPPORT_EVENT_LIMIT = 200;
export const SUPPORT_RAW_NOTIFICATION_LIMIT = 100;

export type SupportProjectedJson =
  | null
  | boolean
  | number
  | string
  | SupportProjectedJson[]
  | { [key: string]: SupportProjectedJson };

export interface SupportWindowMetaV1 {
  schemaVersion: 1;
  selection: "newest_matching";
  presentationOrder: "updated_desc_id_asc" | "seq_asc";
  itemLimit: number;
  responseByteLimit: number;
  returnedItems: number;
  omittedOversizedItems: number;
  completeness: "complete" | "limit_uncertain";
}

export type SupportEndpointState = "included" | "omitted" | "limit_uncertain";

export type SupportEndpointReason =
  | "session_unavailable"
  | "session_timeout"
  | "session_invalid"
  | "session_window_limit_uncertain";

export interface SupportSummaryEndpointV1 {
  capturedAt: string;
  state: SupportEndpointState;
  reason?: SupportEndpointReason;
  includedBytes: number;
  window: SupportWindowMetaV1;
  payload?: SupportProjectedJson;
}

export interface SupportListEndpointV1 {
  capturedAt: string;
  state: SupportEndpointState;
  reason?: SupportEndpointReason;
  includedBytes: number;
  window: SupportWindowMetaV1;
  payload: Array<{ index: number; value: SupportProjectedJson }>;
}

export interface SupportSessionCaptureV1 {
  index: number;
  sessionId: string;
  summary: SupportSummaryEndpointV1;
  events: SupportListEndpointV1;
  rawNotifications: SupportListEndpointV1;
}

export interface SupportSessionEvidenceEnvelopeV1 {
  schemaVersion: 1;
  workspaceId: string;
  anyharnessWorkspaceId: string;
  selection: "active_session" | "recent_activity";
  sourceTimeFrom: string;
  sourceTimeTo: string;
  totalReadBytes: number;
  sessions: SupportSessionCaptureV1[];
}

export interface MeasuredSupportWindow {
  value: unknown;
  responseBytes: number;
}

export interface SupportSessionEvidenceClient {
  listSupportWindow(
    workspaceId: string,
    options:
      | {
          mode: "exact";
          sessionId: string;
          updatedAtTo: string;
          limit: 1;
          maxResponseBytes: 1_048_576;
          request: { signal: AbortSignal };
        }
      | {
          mode: "recent";
          updatedAtFrom: string;
          updatedAtTo: string;
          limit: 3;
          maxResponseBytes: 1_048_576;
          request: { signal: AbortSignal };
        },
  ): Promise<MeasuredSupportWindow>;
  listEventsSupportWindow(
    sessionId: string,
    options: {
      timestampFrom: string;
      timestampTo: string;
      limit: 200;
      maxResponseBytes: 4_194_304;
      request: { signal: AbortSignal };
    },
  ): Promise<MeasuredSupportWindow>;
  listRawNotificationsSupportWindow(
    sessionId: string,
    options: {
      timestampFrom: string;
      timestampTo: string;
      limit: 100;
      maxResponseBytes: 2_097_152;
      request: { signal: AbortSignal };
    },
  ): Promise<MeasuredSupportWindow>;
}
