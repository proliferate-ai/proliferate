import type {
  SupportSessionCollectionManifestV1,
  SupportSnapshotPreparation,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  BundledLocalSupportSelection,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import {
  type BoundSupportSessionEvidencePort,
  type SupportListEndpointV1,
  type SupportSessionCaptureV1,
  type SupportSessionEvidenceEnvelopeV1,
  type SupportSessionListEndpointV1,
  type SupportSummaryEndpointV1,
} from "#product/lib/domain/support/support-session-contract";
import {
  compareUnicodeCodePoints,
  createSupportProjectionBudget,
  projectSupportSessionSummaryValue,
  projectSupportSessionValue,
  restoreSupportProjectionBudget,
  type SupportProjectionBudget,
} from "#product/lib/domain/support/support-session-projector";
import type {
  DecodedSupportWindow,
  ExpectedSupportWindow,
} from "#product/lib/domain/support/support-session-window";
import {
  decodeSupportWindow,
} from "#product/lib/domain/support/support-session-window";
import {
  EVENTS_WINDOW,
  RAW_WINDOW,
  SESSION_ACTIVE_WINDOW,
  SESSION_RECENT_WINDOW,
  eventsRequest,
  failureReason,
  forwardAbort,
  isSuperseded,
  omittedList,
  omittedSummary,
  rawRequest,
  settleMeasured,
  type SettledMeasured,
} from "#product/lib/workflows/support/support-session-evidence-access";
import {
  addSupportSeconds,
  compareSupportInstants,
  exactIdentity,
  hasSafeOwnDataShape,
  inTimestampWindow,
  isExactIdentityValue,
  ownSafeNonnegativeInteger,
  ownUtcTimestamp,
  parseCanonicalSupportTimestamp,
  supportDeadlineDelayMilliseconds,
  supportInstantFromEpochMilliseconds,
  timestampInstant,
  timestampNotAfter,
  type SupportUtcInstant,
  validPreparationWindow,
} from "#product/lib/workflows/support/support-session-evidence-validation";
import {
  finishIncluded,
} from "#product/lib/workflows/support/support-session-evidence-result";

const COLLECTION_TIMEOUT_SECONDS = 5;
const TIMEOUT_REASON = Symbol("support_session_timeout");

export interface BoundSupportSessionEvidenceInput {
  preparation: SupportSnapshotPreparation;
  port: BoundSupportSessionEvidencePort;
  selection: BundledLocalSupportSelection;
  cancellationSignal?: AbortSignal;
  isSelectionCurrent?: () => boolean;
}

export type CollectedSupportSessionEvidence =
  | {
      state: "included";
      sessionEvidenceJson: string;
      sessionCollection: Extract<SupportSessionCollectionManifestV1, { state: "included" }>;
      envelope: SupportSessionEvidenceEnvelopeV1;
    }
  | {
      state: "omitted";
      sessionEvidenceJson: null;
      sessionCollection: Extract<SupportSessionCollectionManifestV1, { state: "omitted" }>;
    }
  | { state: "cancelled" };

export async function collectBoundSupportSessionEvidence(
  input: BoundSupportSessionEvidenceInput,
): Promise<CollectedSupportSessionEvidence> {
  if (
    !validPreparationWindow(input.preparation)
    || !isExactIdentityValue(input.selection.workspace.workspaceId)
    || !isExactIdentityValue(input.selection.workspace.anyharnessWorkspaceId)
    || (input.selection.kind === "active_session"
      && (!isExactIdentityValue(input.selection.uiSessionId)
        || !isExactIdentityValue(input.selection.materializedSessionId)))
  ) {
    return { state: "cancelled" };
  }
  const capturedAt = parseCanonicalSupportTimestamp(input.preparation.capturedAt);
  if (!capturedAt) return { state: "cancelled" };
  const deadline = addSupportSeconds(capturedAt, COLLECTION_TIMEOUT_SECONDS);
  const now = supportInstantFromEpochMilliseconds(Date.now());
  if (compareSupportInstants(now, deadline) >= 0) {
    return omittedCollection("session_timeout");
  }
  const controller = new AbortController();
  const removeForwarder = forwardAbort(input.cancellationSignal, controller);
  const timeout = setTimeout(
    () => controller.abort(TIMEOUT_REASON),
    supportDeadlineDelayMilliseconds(now, deadline),
  );
  try {
    if (isSuperseded(input)) return { state: "cancelled" };
    const result = input.selection.kind === "active_session"
      ? await collectActive(
          input as BoundSupportSessionEvidenceInput & {
            selection: Extract<BoundSupportSessionEvidenceInput["selection"], {
              kind: "active_session";
            }>;
          },
          controller.signal,
          deadline,
        )
      : await collectRecent(
          input as BoundSupportSessionEvidenceInput & {
            selection: Extract<BoundSupportSessionEvidenceInput["selection"], {
              kind: "recent_activity";
            }>;
          },
          controller.signal,
          deadline,
        );
    if (isSuperseded(input)) return { state: "cancelled" };
    return result;
  } finally {
    clearTimeout(timeout);
    removeForwarder();
    controller.abort();
  }
}

async function collectActive(
  input: BoundSupportSessionEvidenceInput & {
    selection: Extract<BoundSupportSessionEvidenceInput["selection"], { kind: "active_session" }>;
  },
  signal: AbortSignal,
  deadline: SupportUtcInstant,
): Promise<CollectedSupportSessionEvidence> {
  const sessionId = input.selection.materializedSessionId;
  const [summaryResult, eventsResult, rawResult] = await Promise.all([
    settleMeasured(
      () => input.port.listSessions({
        mode: "exact",
        sessionId,
        updatedAtTo: input.preparation.capturedAt,
        signal,
      }),
      signal,
      deadline,
      TIMEOUT_REASON,
    ),
    settleMeasured(() => eventsRequest(input.port, sessionId, input.preparation, signal), signal,
      deadline, TIMEOUT_REASON),
    settleMeasured(() => rawRequest(input.port, sessionId, input.preparation, signal), signal,
      deadline, TIMEOUT_REASON),
  ]);
  const budget = createSupportProjectionBudget();
  const summary = projectActiveSummary(
    summaryResult,
    input.selection,
    input.preparation,
    budget,
  );
  const events = projectListEndpoint(
    eventsResult,
    EVENTS_WINDOW,
    input.preparation,
    sessionId,
    budget,
  );
  const raw = projectListEndpoint(rawResult, RAW_WINDOW, input.preparation, sessionId, budget);
  const session: SupportSessionCaptureV1 = {
    index: 0,
    sessionId,
    summary: summary.endpoint,
    events: events.endpoint,
    rawNotifications: raw.endpoint,
  };
  return finishIncluded(
    input,
    [session],
    sessionListFromSummary(summary.endpoint),
    [summary.readBytes, events.readBytes, raw.readBytes],
  );
}

async function collectRecent(
  input: BoundSupportSessionEvidenceInput & {
    selection: Extract<BoundSupportSessionEvidenceInput["selection"], { kind: "recent_activity" }>;
  },
  signal: AbortSignal,
  deadline: SupportUtcInstant,
): Promise<CollectedSupportSessionEvidence> {
  const summaryResult = await settleMeasured(
    () => input.port.listSessions({
      mode: "recent",
      updatedAtFrom: input.preparation.window.sourceTimeFrom,
      updatedAtTo: input.preparation.capturedAt,
      signal,
    }),
    signal,
    deadline,
    TIMEOUT_REASON,
  );
  if (summaryResult.state !== "fulfilled") {
    return omittedCollection(failureReason(summaryResult));
  }
  const decoded = decodeSupportWindow(summaryResult.value, SESSION_RECENT_WINDOW);
  if (decoded.state !== "decoded") return omittedCollection("session_invalid");
  const projected = projectRecentSummaries(decoded, input.selection, input.preparation);
  if (projected.state !== "projected") return omittedCollection("session_invalid");
  if (isSuperseded(input)) return { state: "cancelled" };
  const sessionList = sessionListEndpoint(
    decoded,
    summaryResult.capturedAt,
    projected.sessions.length > 0 ? decoded.responseBytes : 0,
  );

  const sessions = await Promise.all(projected.sessions.map(async (summary, index) => {
    const [eventsResult, rawResult] = await Promise.all([
      settleMeasured(() => eventsRequest(input.port, summary.sessionId, input.preparation, signal),
        signal, deadline, TIMEOUT_REASON),
      settleMeasured(() => rawRequest(input.port, summary.sessionId, input.preparation, signal),
        signal, deadline, TIMEOUT_REASON),
    ]);
    const events = projectListEndpoint(
      eventsResult,
      EVENTS_WINDOW,
      input.preparation,
      summary.sessionId,
      summary.budget,
    );
    const raw = projectListEndpoint(
      rawResult,
      RAW_WINDOW,
      input.preparation,
      summary.sessionId,
      summary.budget,
    );
    return {
      session: {
        index,
        sessionId: summary.sessionId,
        summary: summaryEndpoint(sessionList, summary.value, index === 0
          ? sessionList.includedBytes
          : 0),
        events: events.endpoint,
        rawNotifications: raw.endpoint,
      },
      readBytes: [events.readBytes, raw.readBytes],
    };
  }));
  return finishIncluded(
    input,
    sessions.map((session) => session.session),
    sessionList,
    [decoded.responseBytes, ...sessions.flatMap((session) => session.readBytes)],
  );
}

interface ProjectedSummary {
  sessionId: string;
  value: ReturnType<typeof projectSupportSessionValue> & { state: "projected" };
  budget: SupportProjectionBudget;
}

function projectRecentSummaries(
  window: Extract<DecodedSupportWindow, { state: "decoded" }>,
  selection: Extract<BoundSupportSessionEvidenceInput["selection"], { kind: "recent_activity" }>,
  preparation: SupportSnapshotPreparation,
): { state: "projected"; sessions: ProjectedSummary[] } | { state: "invalid" } {
  const output: ProjectedSummary[] = [];
  const seen = new Set<string>();
  let previousUpdatedAt: SupportUtcInstant | null = null;
  let previousId = "";
  for (const item of window.items) {
    const sessionId = exactIdentity(item, "id");
    const workspaceId = exactIdentity(item, "workspaceId");
    const updatedAt = ownUtcTimestamp(item, "updatedAt");
    const updatedInstant = updatedAt ? timestampInstant(updatedAt) : null;
    const comparedToPrevious = updatedInstant && previousUpdatedAt
      ? compareSupportInstants(updatedInstant, previousUpdatedAt)
      : -1;
    if (
      !sessionId
      || workspaceId !== selection.workspace.anyharnessWorkspaceId
      || !updatedAt
      || !updatedInstant
      || !inTimestampWindow(updatedAt, preparation.window.sourceTimeFrom, preparation.capturedAt)
      || seen.has(sessionId)
      || comparedToPrevious > 0
      || (comparedToPrevious === 0
        && compareUnicodeCodePoints(previousId, sessionId) >= 0)
    ) {
      return { state: "invalid" };
    }
    const budget = createSupportProjectionBudget();
    const value = projectSupportSessionSummaryValue(item, budget);
    if (
      value.state !== "projected"
      || exactIdentity(value.value, "id") !== sessionId
      || exactIdentity(value.value, "workspaceId") !== workspaceId
      || ownUtcTimestamp(value.value, "updatedAt") !== updatedAt
    ) return { state: "invalid" };
    output.push({ sessionId, value, budget });
    seen.add(sessionId);
    previousUpdatedAt = updatedInstant;
    previousId = sessionId;
  }
  return { state: "projected", sessions: output };
}

function projectActiveSummary(
  result: SettledMeasured,
  selection: Extract<BoundSupportSessionEvidenceInput["selection"], { kind: "active_session" }>,
  preparation: SupportSnapshotPreparation,
  budget: SupportProjectionBudget,
): { endpoint: SupportSummaryEndpointV1; readBytes: number } {
  if (result.state !== "fulfilled") {
    return {
      endpoint: omittedSummary(result.capturedAt, failureReason(result), SESSION_ACTIVE_WINDOW),
      readBytes: 0,
    };
  }
  const decoded = decodeSupportWindow(result.value, SESSION_ACTIVE_WINDOW);
  if (decoded.state !== "decoded") {
    return {
      endpoint: omittedSummary(result.capturedAt, "session_invalid", SESSION_ACTIVE_WINDOW),
      readBytes: decoded.responseBytes ?? 0,
    };
  }
  if (decoded.items.length === 0) {
    if (decoded.window.completeness === "limit_uncertain") {
      return {
        endpoint: {
          capturedAt: result.capturedAt,
          state: "limit_uncertain",
          reason: "session_window_limit_uncertain",
          includedBytes: 0,
          window: decoded.window,
        },
        readBytes: decoded.responseBytes,
      };
    }
    return {
      endpoint: omittedSummary(result.capturedAt, "session_unavailable", SESSION_ACTIVE_WINDOW),
      readBytes: decoded.responseBytes,
    };
  }
  const item = decoded.items[0];
  const itemId = exactIdentity(item, "id");
  const itemWorkspaceId = exactIdentity(item, "workspaceId");
  const updatedAt = ownUtcTimestamp(item, "updatedAt");
  if (
    itemId !== selection.materializedSessionId
    || itemWorkspaceId !== selection.workspace.anyharnessWorkspaceId
    || !updatedAt
    || !timestampNotAfter(updatedAt, preparation.capturedAt)
  ) {
    return {
      endpoint: omittedSummary(result.capturedAt, "session_invalid", SESSION_ACTIVE_WINDOW),
      readBytes: decoded.responseBytes,
    };
  }
  const projected = projectSupportSessionSummaryValue(item, budget);
  if (
    projected.state !== "projected"
    || exactIdentity(projected.value, "id") !== itemId
    || exactIdentity(projected.value, "workspaceId") !== itemWorkspaceId
    || ownUtcTimestamp(projected.value, "updatedAt") !== updatedAt
  ) {
    return {
      endpoint: omittedSummary(result.capturedAt, "session_invalid", SESSION_ACTIVE_WINDOW),
      readBytes: decoded.responseBytes,
    };
  }
  return {
    endpoint: summaryEndpoint(
      sessionListEndpoint(decoded, result.capturedAt, decoded.responseBytes),
      projected,
      decoded.responseBytes,
    ),
    readBytes: decoded.responseBytes,
  };
}

function summaryEndpoint(
  sessionList: SupportSessionListEndpointV1,
  projected: ReturnType<typeof projectSupportSessionValue> & { state: "projected" },
  includedBytes: number,
): SupportSummaryEndpointV1 {
  return {
    ...sessionList,
    includedBytes,
    payload: projected.value,
  };
}

function sessionListEndpoint(
  decoded: Extract<DecodedSupportWindow, { state: "decoded" }>,
  capturedAt: string,
  includedBytes: number,
): SupportSessionListEndpointV1 {
  const uncertain = decoded.window.completeness === "limit_uncertain";
  return {
    capturedAt,
    state: uncertain ? "limit_uncertain" : "included",
    ...(uncertain ? { reason: "session_window_limit_uncertain" as const } : {}),
    includedBytes,
    window: decoded.window,
  };
}

function sessionListFromSummary(
  summary: SupportSummaryEndpointV1,
): SupportSessionListEndpointV1 {
  return {
    capturedAt: summary.capturedAt,
    state: summary.state,
    ...(summary.reason ? { reason: summary.reason } : {}),
    includedBytes: summary.includedBytes,
    window: summary.window,
  };
}

function projectListEndpoint(
  result: SettledMeasured,
  expected: ExpectedSupportWindow,
  preparation: SupportSnapshotPreparation,
  expectedSessionId: string,
  budget: SupportProjectionBudget,
): { endpoint: SupportListEndpointV1; readBytes: number } {
  if (result.state !== "fulfilled") {
    return {
      endpoint: omittedList(result.capturedAt, failureReason(result), expected),
      readBytes: 0,
    };
  }
  const decoded = decodeSupportWindow(result.value, expected);
  if (decoded.state !== "decoded") {
    return {
      endpoint: omittedList(result.capturedAt, "session_invalid", expected),
      readBytes: decoded.responseBytes ?? 0,
    };
  }
  const retained: Array<{ seq: number; timestamp: string; value: unknown }> = [];
  const seen = new Set<number>();
  let priorSeq = -1;
  for (let sourceIndex = 0; sourceIndex < decoded.items.length; sourceIndex += 1) {
    const item = decoded.items[sourceIndex];
    if (!hasSafeOwnDataShape(item)) {
      return {
        endpoint: omittedList(result.capturedAt, "session_invalid", expected),
        readBytes: decoded.responseBytes,
      };
    }
    const seq = ownSafeNonnegativeInteger(item, "seq");
    const timestamp = ownUtcTimestamp(item, "timestamp");
    if (
      seq === null
      || !timestamp
      || exactIdentity(item, "sessionId") !== expectedSessionId
      || !inTimestampWindow(timestamp, preparation.window.sourceTimeFrom, preparation.capturedAt)
      || seen.has(seq)
      || seq <= priorSeq
    ) {
      continue;
    }
    retained.push({ seq, timestamp, value: item });
    seen.add(seq);
    priorSeq = seq;
  }
  const payload: SupportListEndpointV1["payload"] = [];
  const endpointBudgetStart = budget.copiedValues;
  for (const item of retained) {
    const value = projectSupportSessionValue(item.value, budget);
    if (value.state !== "projected") {
      restoreSupportProjectionBudget(budget, endpointBudgetStart);
      return {
        endpoint: omittedList(result.capturedAt, "session_invalid", expected),
        readBytes: decoded.responseBytes,
      };
    }
    if (
      ownSafeNonnegativeInteger(value.value, "seq") !== item.seq
      || ownUtcTimestamp(value.value, "timestamp") !== item.timestamp
      || exactIdentity(value.value, "sessionId") !== expectedSessionId
    ) {
      restoreSupportProjectionBudget(budget, endpointBudgetStart);
      return {
        endpoint: omittedList(result.capturedAt, "session_invalid", expected),
        readBytes: decoded.responseBytes,
      };
    }
    payload.push({ index: payload.length, value: value.value });
  }
  const uncertain = decoded.window.completeness === "limit_uncertain";
  return {
    endpoint: {
      capturedAt: result.capturedAt,
      state: uncertain ? "limit_uncertain" : "included",
      ...(uncertain ? { reason: "session_window_limit_uncertain" as const } : {}),
      includedBytes: payload.length > 0 ? decoded.responseBytes : 0,
      window: decoded.window,
      payload,
    },
    readBytes: decoded.responseBytes,
  };
}

function omittedCollection(
  reason: "session_unavailable" | "session_timeout" | "session_invalid",
): CollectedSupportSessionEvidence {
  return {
    state: "omitted",
    sessionEvidenceJson: null,
    sessionCollection: { state: "omitted", reason },
  };
}
