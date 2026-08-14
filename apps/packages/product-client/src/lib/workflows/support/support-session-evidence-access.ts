import type { SupportSnapshotPreparation } from "@proliferate/product-client/host/desktop-bridge";
import {
  SUPPORT_EVENT_LIMIT,
  SUPPORT_EVENT_LIST_BYTES,
  SUPPORT_RAW_NOTIFICATION_LIMIT,
  SUPPORT_RAW_NOTIFICATION_LIST_BYTES,
  SUPPORT_SESSION_LIMIT,
  SUPPORT_SESSION_LIST_BYTES,
  type BoundSupportSessionEvidencePort,
  type MeasuredSupportWindow,
  type SupportEndpointReason,
  type SupportListEndpointV1,
  type SupportSummaryEndpointV1,
} from "#product/lib/domain/support/support-session-contract";
import {
  compareSupportInstants,
  supportInstantFromEpochMilliseconds,
  supportInstantToTimestamp,
  type SupportUtcInstant,
} from "#product/lib/workflows/support/support-session-evidence-validation";
import {
  syntheticSupportWindow,
  type ExpectedSupportWindow,
} from "#product/lib/domain/support/support-session-window";

export const SESSION_ACTIVE_WINDOW = expectedWindow(
  "updated_desc_id_asc", 1, SUPPORT_SESSION_LIST_BYTES,
);
export const SESSION_RECENT_WINDOW = expectedWindow(
  "updated_desc_id_asc", SUPPORT_SESSION_LIMIT, SUPPORT_SESSION_LIST_BYTES,
);
export const EVENTS_WINDOW = expectedWindow(
  "seq_asc", SUPPORT_EVENT_LIMIT, SUPPORT_EVENT_LIST_BYTES,
);
export const RAW_WINDOW = expectedWindow(
  "seq_asc", SUPPORT_RAW_NOTIFICATION_LIMIT, SUPPORT_RAW_NOTIFICATION_LIST_BYTES,
);

export type SettledMeasured =
  | { state: "fulfilled"; value: MeasuredSupportWindow; capturedAt: string }
  | { state: "aborted"; timedOut: boolean; capturedAt: string }
  | { state: "rejected"; capturedAt: string };

interface SupersedableInput {
  cancellationSignal?: AbortSignal;
  isSelectionCurrent?: () => boolean;
}

const DEADLINE_REACHED = Symbol("support_deadline_reached");

export async function settleMeasured(
  operation: () => Promise<MeasuredSupportWindow>,
  signal: AbortSignal,
  deadline: SupportUtcInstant,
  timeoutReason: symbol,
): Promise<SettledMeasured> {
  const initial = clockSnapshot();
  if (signal.aborted || reachedDeadline(initial.instant, deadline)) {
    return abortedAt(initial, signal, deadline, timeoutReason);
  }

  let removeAbort: () => void = () => undefined;
  const promise = Promise.resolve().then(() => {
    const started = clockSnapshot();
    if (reachedDeadline(started.instant, deadline)) throw DEADLINE_REACHED;
    if (signal.aborted) throw signal.reason;
    return operation();
  });
  const settled = promise.then<SettledMeasured, SettledMeasured>(
    (value) => {
      const accepted = clockSnapshot();
      return reachedDeadline(accepted.instant, deadline)
        ? abortedAt(accepted, signal, deadline, timeoutReason)
        : { state: "fulfilled", value, capturedAt: accepted.timestamp };
    },
    (error: unknown) => {
      const accepted = clockSnapshot();
      if (
        signal.aborted
        || error === DEADLINE_REACHED
        || reachedDeadline(accepted.instant, deadline)
      ) {
        return abortedAt(accepted, signal, deadline, timeoutReason);
      }
      return { state: "rejected", capturedAt: accepted.timestamp };
    },
  );
  const aborted = new Promise<SettledMeasured>((resolve) => {
    const finish = () => {
      const accepted = clockSnapshot();
      resolve(abortedAt(accepted, signal, deadline, timeoutReason));
    };
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

export async function eventsRequest(
  port: BoundSupportSessionEvidencePort,
  sessionId: string,
  preparation: SupportSnapshotPreparation,
  signal: AbortSignal,
): Promise<MeasuredSupportWindow> {
  return port.listEvents({
    sessionId,
    timestampFrom: preparation.window.sourceTimeFrom,
    timestampTo: preparation.window.sourceTimeTo,
    signal,
  });
}

export async function rawRequest(
  port: BoundSupportSessionEvidencePort,
  sessionId: string,
  preparation: SupportSnapshotPreparation,
  signal: AbortSignal,
): Promise<MeasuredSupportWindow> {
  return port.listRawNotifications({
    sessionId,
    timestampFrom: preparation.window.sourceTimeFrom,
    timestampTo: preparation.window.sourceTimeTo,
    signal,
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

export function isSuperseded(input: SupersedableInput): boolean {
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

function abortedAt(
  captured: ReturnType<typeof clockSnapshot>,
  signal: AbortSignal,
  deadline: SupportUtcInstant,
  timeoutReason: symbol,
): SettledMeasured {
  return {
    state: "aborted",
    timedOut: signal.reason === timeoutReason || reachedDeadline(captured.instant, deadline),
    capturedAt: captured.timestamp,
  };
}

function reachedDeadline(now: SupportUtcInstant, deadline: SupportUtcInstant): boolean {
  return compareSupportInstants(now, deadline) >= 0;
}

function clockSnapshot(): { instant: SupportUtcInstant; timestamp: string } {
  const milliseconds = Date.now();
  const instant = supportInstantFromEpochMilliseconds(milliseconds);
  return {
    instant,
    timestamp: supportInstantToTimestamp(instant),
  };
}

function expectedWindow(
  presentationOrder: ExpectedSupportWindow["presentationOrder"],
  itemLimit: number,
  responseByteLimit: number,
): ExpectedSupportWindow {
  return { presentationOrder, itemLimit, responseByteLimit };
}
