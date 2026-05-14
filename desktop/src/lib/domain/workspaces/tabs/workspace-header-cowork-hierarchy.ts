import type {
  CoworkManagedWorkspacesResponse,
  CoworkManagedWorkspaceSummary,
} from "@anyharness/sdk";
import type {
  HeaderHierarchyChildRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";

export interface HeaderCoworkRelationshipHint {
  sessionId: string;
  parentSessionId: string;
  sessionLinkId: string;
  workspaceId: string;
}

export function coworkResponseSignature(
  response: CoworkManagedWorkspacesResponse | null | undefined,
): string {
  if (!response) {
    return "";
  }
  return response.workspaces.map((workspace) => [
    workspace.ownershipId,
    workspace.workspaceId,
    workspace.label ?? "",
    workspace.sessions.map((session) => [
      session.sessionLinkId,
      session.codingSessionId,
      session.label ?? "",
      session.title ?? "",
      session.agentKind,
      session.status,
      session.wakeScheduled ? "wake" : "",
    ].join(":")).join("|"),
  ].join("\u001f")).join("\u001e");
}

export function buildCoworkChildRows(
  workspaces: readonly CoworkManagedWorkspaceSummary[],
  parentSessionId: string,
  resolveClientSessionId: (sessionId: string) => string,
): HeaderHierarchyChildRow[] {
  return workspaces.flatMap((workspace, workspaceIndex) =>
    workspace.sessions.map((session, sessionIndex) => ({
      sessionLinkId: session.sessionLinkId,
      sessionId: resolveClientSessionId(session.codingSessionId),
      parentSessionId,
      title: session.label?.trim()
        || session.title?.trim()
        || `Cowork agent ${workspaceIndex + 1}.${sessionIndex + 1}`,
      agentKind: session.agentKind,
      source: "cowork",
      meta: workspace.label?.trim() || "Cowork",
      statusLabel: formatCoworkSessionStatus(session.status),
      wakeScheduled: session.wakeScheduled,
      isActive: false,
    }))
  );
}

export function buildCoworkRelationshipHintSignature(
  hints: readonly HeaderCoworkRelationshipHint[],
): string {
  return hints
    .map((hint) => [
      hint.sessionId,
      hint.parentSessionId,
      hint.sessionLinkId,
      hint.workspaceId,
    ].join(":"))
    .sort()
    .join("|");
}

function formatCoworkSessionStatus(status: string): string {
  switch (status) {
    case "running":
      return "Working";
    case "idle":
      return "Idle";
    case "completed":
      return "Done";
    case "errored":
      return "Failed";
    case "starting":
      return "Starting";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}
