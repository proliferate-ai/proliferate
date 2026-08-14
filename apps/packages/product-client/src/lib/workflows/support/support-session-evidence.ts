import type {
  SupportSessionCollectionManifestV1,
  SupportSnapshotPreparation,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  BundledLocalSupportSelection,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import {
  type BoundSupportSessionEvidencePort,
  type SupportSessionCaptureV1,
  type SupportSessionEvidenceEnvelopeV1,
} from "#product/lib/domain/support/support-session-contract";
import {
  createSupportProjectionBudget,
} from "#product/lib/domain/support/support-session-projector";
import {
  decodeSupportWindow,
} from "#product/lib/domain/support/support-session-window";
import {
  EVENTS_WINDOW,
  RAW_WINDOW,
  SESSION_RECENT_WINDOW,
  eventsRequest,
  failureReason,
  forwardAbort,
  isSuperseded,
  rawRequest,
  settleMeasured,
} from "#product/lib/workflows/support/support-session-evidence-access";
import {
  addSupportSeconds,
  compareSupportInstants,
  isExactIdentityValue,
  parseCanonicalSupportTimestamp,
  supportDeadlineDelayMilliseconds,
  supportInstantFromEpochMilliseconds,
  type SupportUtcInstant,
  validPreparationWindow,
} from "#product/lib/workflows/support/support-session-evidence-validation";
import {
  finishIncluded,
} from "#product/lib/workflows/support/support-session-evidence-result";
import {
  projectActiveSummary,
  projectListEndpoint,
  projectRecentSummaries,
  sessionListEndpoint,
  sessionListFromSummary,
  summaryEndpoint,
} from "#product/lib/workflows/support/support-session-evidence-projection";

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

function omittedCollection(
  reason: "session_unavailable" | "session_timeout" | "session_invalid",
): CollectedSupportSessionEvidence {
  return {
    state: "omitted",
    sessionEvidenceJson: null,
    sessionCollection: { state: "omitted", reason },
  };
}
