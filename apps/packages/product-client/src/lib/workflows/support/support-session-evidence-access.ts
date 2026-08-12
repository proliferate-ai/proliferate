import type { SupportSnapshotPreparation } from "@proliferate/product-client/host/desktop-bridge";
import {
  SUPPORT_EVENT_LIMIT,
  SUPPORT_EVENT_LIST_BYTES,
  SUPPORT_RAW_NOTIFICATION_LIMIT,
  SUPPORT_RAW_NOTIFICATION_LIST_BYTES,
  type MeasuredSupportWindow,
  type SupportEndpointReason,
  type SupportListEndpointV1,
  type SupportSessionEvidenceClient,
  type SupportSummaryEndpointV1,
} from "#product/lib/domain/support/support-session-contract";
import {
  syntheticSupportWindow,
  type ExpectedSupportWindow,
} from "#product/lib/domain/support/support-session-window";
import type {
  CollectSupportSessionEvidenceInput,
} from "#product/lib/workflows/support/support-session-evidence";

const COLLECTION_TIMEOUT_MS = 5_000;

export const SESSION_ACTIVE_WINDOW = expectedWindow("updated_desc_id_asc", 1, 1_048_576);
export const SESSION_RECENT_WINDOW = expectedWindow("updated_desc_id_asc", 3, 1_048_576);
export const EVENTS_WINDOW = expectedWindow("seq_asc", 200, 4_194_304);
export const RAW_WINDOW = expectedWindow("seq_asc", 100, 2_097_152);

export type SettledMeasured =
  | { state: "fulfilled"; value: MeasuredSupportWindow; capturedAt: string }
  | { state: "aborted"; timedOut: boolean; capturedAt: string }
  | { state: "rejected"; capturedAt: string };

export async function settleMeasured(
  operation: () => Promise<MeasuredSupportWindow>,
  signal: AbortSignal,
  nativeCapturedAt: string,
  timeoutReason: symbol,
): Promise<SettledMeasured> {
  if (signal.aborted) {
    return {
      state: "aborted",
      timedOut: signal.reason === timeoutReason,
      capturedAt: boundedCapturedAt(nativeCapturedAt),
    };
  }
  let removeAbort = () => undefined;
  const promise = Promise.resolve().then(() => {
    if (signal.aborted) throw signal.reason;
    return operation();
  });
  const settled = promise.then<SettledMeasured>(
    (value) => ({ state: "fulfilled", value, capturedAt: boundedCapturedAt(nativeCapturedAt) }),
    () => signal.aborted
      ? {
          state: "aborted",
          timedOut: signal.reason === timeoutReason,
          capturedAt: boundedCapturedAt(nativeCapturedAt),
        }
      : { state: "rejected", capturedAt: boundedCapturedAt(nativeCapturedAt) },
  );
  const aborted = new Promise<SettledMeasured>((resolve) => {
    const finish = () => resolve({
      state: "aborted",
      timedOut: signal.reason === timeoutReason,
      capturedAt: boundedCapturedAt(nativeCapturedAt),
    });
    if (signal.aborted) finish();
    else {
      signal.addEventListener("abort", finish, { once: true });
      removeAbort = () => signal.removeEventListener("abort", finish);
    }
  });
  try {
    return await Promise.race([settled, aborted]);
  } finally {
    removeAbort();
  }
}

export function eventsRequest(
  client: SupportSessionEvidenceClient,
  sessionId: string,
  preparation: SupportSnapshotPreparation,
  signal: AbortSignal,
): Promise<MeasuredSupportWindow> {
  return client.listEventsSupportWindow(sessionId, {
    timestampFrom: preparation.window.sourceTimeFrom,
    timestampTo: preparation.window.sourceTimeTo,
    limit: SUPPORT_EVENT_LIMIT,
    maxResponseBytes: SUPPORT_EVENT_LIST_BYTES,
    request: { signal },
  });
}

export function rawRequest(
  client: SupportSessionEvidenceClient,
  sessionId: string,
  preparation: SupportSnapshotPreparation,
  signal: AbortSignal,
): Promise<MeasuredSupportWindow> {
  return client.listRawNotificationsSupportWindow(sessionId, {
    timestampFrom: preparation.window.sourceTimeFrom,
    timestampTo: preparation.window.sourceTimeTo,
    limit: SUPPORT_RAW_NOTIFICATION_LIMIT,
    maxResponseBytes: SUPPORT_RAW_NOTIFICATION_LIST_BYTES,
    request: { signal },
  });
}

export function omittedSummary(
  capturedAt: string,
  reason: Exclude<SupportEndpointReason, "session_window_limit_uncertain">,
  expected: ExpectedSupportWindow,
): SupportSummaryEndpointV1 {
  return {
    capturedAt,
    state: "omitted",
    reason,
    includedBytes: 0,
    window: syntheticSupportWindow(expected),
  };
}

export function omittedList(
  capturedAt: string,
  reason: Exclude<SupportEndpointReason, "session_window_limit_uncertain">,
  expected: ExpectedSupportWindow,
): SupportListEndpointV1 {
  return {
    capturedAt,
    state: "omitted",
    reason,
    includedBytes: 0,
    window: syntheticSupportWindow(expected),
    payload: [],
  };
}

export function failureReason(
  result: Exclude<SettledMeasured, { state: "fulfilled" }>,
): "session_unavailable" | "session_timeout" {
  return result.state === "aborted" && result.timedOut
    ? "session_timeout"
    : "session_unavailable";
}

export function isSuperseded(input: CollectSupportSessionEvidenceInput): boolean {
  if (input.cancellationSignal?.aborted === true) return true;
  try {
    return input.isSelectionCurrent?.() === false;
  } catch {
    return true;
  }
}

export function forwardAbort(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => undefined;
  const abort = () => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function expectedWindow(
  presentationOrder: ExpectedSupportWindow["presentationOrder"],
  itemLimit: number,
  responseByteLimit: number,
): ExpectedSupportWindow {
  return { presentationOrder, itemLimit, responseByteLimit };
}

function boundedCapturedAt(nativeCapturedAt: string): string {
  const nativeMs = Date.parse(nativeCapturedAt);
  if (!Number.isFinite(nativeMs)) return nativeCapturedAt;
  return new Date(Math.min(Math.max(Date.now(), nativeMs), nativeMs + COLLECTION_TIMEOUT_MS))
    .toISOString();
}
