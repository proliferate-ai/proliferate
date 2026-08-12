import type {
  SupportSessionCollectionManifestV1,
} from "@proliferate/product-client/host/desktop-bridge";
import {
  SUPPORT_SESSION_EVIDENCE_BYTES,
  type SupportSessionCaptureV1,
  type SupportSessionEvidenceEnvelopeV1,
} from "#product/lib/domain/support/support-session-contract";
import {
  stringifySupportSessionEvidence,
} from "#product/lib/domain/support/support-session-projector";
import type {
  CollectedSupportSessionEvidence,
  CollectSupportSessionEvidenceInput,
} from "#product/lib/workflows/support/support-session-evidence";

export function finishIncluded(
  input: Pick<CollectSupportSessionEvidenceInput, "preparation" | "selection">,
  sessions: SupportSessionCaptureV1[],
  readBytes: number[],
): CollectedSupportSessionEvidence {
  if (
    sessions.length > 3
    || sessions.some((session, index) => session.index !== index)
    || !endpointShellsCoherent(sessions)
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
  const { sessionIncludedBytes, eventIncludedBytes, rawNotificationIncludedBytes } = sums;
  const attributedBytes = safeSum([
    sessionIncludedBytes,
    eventIncludedBytes,
    rawNotificationIncludedBytes,
  ]);
  if (attributedBytes === null || attributedBytes > totalReadBytes) return invalidCollection();
  const limitUncertainEndpoints = countUncertain(sessions);
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

function endpointShellsCoherent(sessions: SupportSessionCaptureV1[]): boolean {
  return sessions.every((session) => [
    { endpoint: session.summary, list: false },
    { endpoint: session.events, list: true },
    { endpoint: session.rawNotifications, list: true },
  ].every(({ endpoint, list }) => {
    const payloadSize = list && "payload" in endpoint ? endpoint.payload.length : null;
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
  sessionIncludedBytes: number;
  eventIncludedBytes: number;
  rawNotificationIncludedBytes: number;
} | null {
  const sessionIncludedBytes = checkedEndpointSum(sessions, "summary");
  const eventIncludedBytes = checkedEndpointSum(sessions, "events");
  const rawNotificationIncludedBytes = checkedEndpointSum(sessions, "rawNotifications");
  return sessionIncludedBytes === null
    || eventIncludedBytes === null
    || rawNotificationIncludedBytes === null
    ? null
    : { sessionIncludedBytes, eventIncludedBytes, rawNotificationIncludedBytes };
}

function countUncertain(sessions: SupportSessionCaptureV1[]): number {
  const listEndpoints = sessions.reduce((count, session) => count + [
    session.events.state,
    session.rawNotifications.state,
  ].filter((state) => state === "limit_uncertain").length, 0);
  return listEndpoints + (sessions[0]?.summary.state === "limit_uncertain" ? 1 : 0);
}
