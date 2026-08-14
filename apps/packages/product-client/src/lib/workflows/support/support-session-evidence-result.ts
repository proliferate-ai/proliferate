import type {
  SupportSessionCollectionManifestV1,
  SupportSnapshotPreparation,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  BundledLocalSupportSelection,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import {
  SUPPORT_SESSION_EVIDENCE_BYTES,
  type SupportSessionCaptureV1,
  type SupportSessionEvidenceEnvelopeV1,
  type SupportSessionListEndpointV1,
  type SupportListEndpointV1,
  type SupportWindowMetaV1,
} from "#product/lib/domain/support/support-session-contract";
import {
  stringifySupportSessionEvidence,
} from "#product/lib/domain/support/support-session-projector";
import type {
  CollectedSupportSessionEvidence,
} from "#product/lib/workflows/support/support-session-evidence";

export function finishIncluded(
  input: {
    preparation: SupportSnapshotPreparation;
    selection: BundledLocalSupportSelection;
  },
  sessions: SupportSessionCaptureV1[],
  sessionList: SupportSessionListEndpointV1,
  readBytes: number[],
): CollectedSupportSessionEvidence {
  if (
    sessions.length > 3
    || sessions.some((session, index) => session.index !== index)
    || !endpointShellsCoherent(sessions)
    || !sessionListCoherent(input.selection, sessions, sessionList)
  ) {
    return invalidCollection();
  }
  const totalReadBytes = safeSum(readBytes);
  if (totalReadBytes === null || totalReadBytes > SUPPORT_SESSION_EVIDENCE_BYTES) {
    return invalidCollection();
  }
  const envelope: SupportSessionEvidenceEnvelopeV1 = {
    schemaVersion: 1,
    workspaceId: input.selection.workspace.workspaceId,
    anyharnessWorkspaceId: input.selection.workspace.anyharnessWorkspaceId,
    selection: input.selection.kind,
    sourceTimeFrom: input.preparation.window.sourceTimeFrom,
    sourceTimeTo: input.preparation.window.sourceTimeTo,
    totalReadBytes,
    sessionList,
    sessions,
  };
  let sessionEvidenceJson: string;
  try {
    sessionEvidenceJson = stringifySupportSessionEvidence(envelope);
  } catch {
    return invalidCollection();
  }
  if (new TextEncoder().encode(sessionEvidenceJson).length > SUPPORT_SESSION_EVIDENCE_BYTES) {
    return invalidCollection();
  }
  const sums = checkedIncludedSums(sessions);
  if (!sums) return invalidCollection();
  const { summaryIncludedBytes, eventIncludedBytes, rawNotificationIncludedBytes } = sums;
  const sessionIncludedBytes = sessionList.includedBytes;
  if (summaryIncludedBytes !== sessionIncludedBytes) return invalidCollection();
  const attributedBytes = safeSum([
    sessionIncludedBytes,
    eventIncludedBytes,
    rawNotificationIncludedBytes,
  ]);
  if (attributedBytes === null || attributedBytes > totalReadBytes) return invalidCollection();
  const limitUncertainEndpoints = countUncertain(sessionList, sessions);
  if (!Number.isSafeInteger(limitUncertainEndpoints)) return invalidCollection();
  const sessionCollection: Extract<
    SupportSessionCollectionManifestV1,
    { state: "included" }
  > = {
    state: "included",
    workspaceId: envelope.workspaceId,
    anyharnessWorkspaceId: envelope.anyharnessWorkspaceId,
    selectedSessions: sessions.length,
    sessionIncludedBytes,
    eventIncludedBytes,
    rawNotificationIncludedBytes,
    limitUncertainEndpoints,
  };
  return { state: "included", sessionEvidenceJson, sessionCollection, envelope };
}

function sessionListCoherent(
  selection: BundledLocalSupportSelection,
  sessions: SupportSessionCaptureV1[],
  sessionList: SupportSessionListEndpointV1,
): boolean {
  if (!endpointStateCoherent(sessionList)) return false;
  if (selection.kind === "active_session") {
    return sessions.length === 1 && summaryMatchesSessionList(sessions[0].summary, sessionList, 0);
  }
  if (sessionList.state === "omitted" || (sessions.length === 0 && sessionList.includedBytes !== 0)) {
    return false;
  }
  return sessions.every((session, index) => summaryMatchesSessionList(
    session.summary,
    sessionList,
    index,
  ));
}

function summaryMatchesSessionList(
  summary: SupportSessionCaptureV1["summary"],
  sessionList: SupportSessionListEndpointV1,
  index: number,
): boolean {
  return summary.capturedAt === sessionList.capturedAt
    && summary.state === sessionList.state
    && summary.reason === sessionList.reason
    && summary.includedBytes === (index === 0 ? sessionList.includedBytes : 0)
    && windowsEqual(summary.window, sessionList.window);
}

function endpointStateCoherent(endpoint: SupportSessionListEndpointV1): boolean {
  if (endpoint.state === "omitted") {
    return endpoint.includedBytes === 0
      && endpoint.reason !== "session_window_limit_uncertain";
  }
  if (endpoint.state === "limit_uncertain") {
    return endpoint.reason === "session_window_limit_uncertain"
      && endpoint.window.completeness === "limit_uncertain";
  }
  return endpoint.reason === undefined
    && endpoint.window.completeness === "complete"
    && endpoint.window.omittedOversizedItems === 0;
}

function windowsEqual(left: SupportWindowMetaV1, right: SupportWindowMetaV1): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.selection === right.selection
    && left.presentationOrder === right.presentationOrder
    && left.itemLimit === right.itemLimit
    && left.responseByteLimit === right.responseByteLimit
    && left.returnedItems === right.returnedItems
    && left.omittedOversizedItems === right.omittedOversizedItems
    && left.completeness === right.completeness;
}

function endpointShellsCoherent(sessions: SupportSessionCaptureV1[]): boolean {
  return sessions.every((session) => [
    { endpoint: session.summary, list: false },
    { endpoint: session.events, list: true },
    { endpoint: session.rawNotifications, list: true },
  ].every(({ endpoint, list }) => {
    const payloadSize = list ? (endpoint as SupportListEndpointV1).payload.length : null;
    if (endpoint.state === "omitted") {
      return endpoint.includedBytes === 0
        && endpoint.reason !== "session_window_limit_uncertain"
        && (payloadSize === null || payloadSize === 0);
    }
    if (endpoint.state === "limit_uncertain") {
      return endpoint.reason === "session_window_limit_uncertain"
        && endpoint.window.completeness === "limit_uncertain";
    }
    return endpoint.reason === undefined
      && endpoint.window.completeness === "complete"
      && endpoint.window.omittedOversizedItems === 0;
  }));
}

function invalidCollection(): CollectedSupportSessionEvidence {
  return {
    state: "omitted",
    sessionEvidenceJson: null,
    sessionCollection: { state: "omitted", reason: "session_invalid" },
  };
}

function safeSum(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (
      !Number.isSafeInteger(value)
      || value < 0
      || Object.is(value, -0)
      || total > Number.MAX_SAFE_INTEGER - value
    ) return null;
    total += value;
  }
  return total;
}

function checkedEndpointSum(
  sessions: SupportSessionCaptureV1[],
  endpoint: "summary" | "events" | "rawNotifications",
): number | null {
  return safeSum(sessions.map((session) => session[endpoint].includedBytes));
}

function checkedIncludedSums(sessions: SupportSessionCaptureV1[]): {
  summaryIncludedBytes: number;
  eventIncludedBytes: number;
  rawNotificationIncludedBytes: number;
} | null {
  const summaryIncludedBytes = checkedEndpointSum(sessions, "summary");
  const eventIncludedBytes = checkedEndpointSum(sessions, "events");
  const rawNotificationIncludedBytes = checkedEndpointSum(sessions, "rawNotifications");
  return summaryIncludedBytes === null
    || eventIncludedBytes === null
    || rawNotificationIncludedBytes === null
    ? null
    : { summaryIncludedBytes, eventIncludedBytes, rawNotificationIncludedBytes };
}

function countUncertain(
  sessionList: SupportSessionListEndpointV1,
  sessions: SupportSessionCaptureV1[],
): number {
  const listEndpoints = sessions.reduce((count, session) => count + [
    session.events.state,
    session.rawNotifications.state,
  ].filter((state) => state === "limit_uncertain").length, 0);
  return listEndpoints + (sessionList.state === "limit_uncertain" ? 1 : 0);
}
