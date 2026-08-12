import { useCallback } from "react";
import { useWorkspaceShellActions } from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";
import { useAgentsPaneNavigationStore } from "#product/stores/agents/agents-pane-navigation-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import type { SessionRelationship } from "#product/lib/domain/sessions/directory/relationship";

export interface AgentsPaneNavigationTarget {
  workspaceId: string;
  parentSessionId: string;
  childSessionId?: string | null;
  authoritativeCurrentRosterSubagent?: boolean;
  historicalSubagentProvenance?: boolean;
}

export type AgentsPaneTargetClassification =
  | "subagent"
  | "promoted"
  | "other_relationship"
  | "unresolved";

export interface AgentsPaneTargetResolution {
  classification: AgentsPaneTargetClassification;
  clientSessionId: string | null;
  relationship: SessionRelationship | null;
  workspaceId: string;
}

const ROOT_SESSION_RELATIONSHIP = { kind: "root" } as const;

export function isDurableSubagentRelationship(
  relationship: SessionRelationship | null | undefined,
): relationship is Extract<
  SessionRelationship,
  { kind: "subagent_child" | "linked_child" }
> {
  return relationship?.kind === "subagent_child"
    || (
      relationship?.kind === "linked_child"
      && relationship.relation === "subagent"
    );
}

export function historicalSubagentProvenanceRemainsAuthoritative(
  relationship: SessionRelationship | null | undefined,
  hasAuthoritativeWorkspace = false,
): boolean {
  return isDurableSubagentRelationship(relationship)
    || (relationship?.kind === "pending" && hasAuthoritativeWorkspace);
}

export function resolveCurrentSessionRelationship(
  directory: Pick<
    ReturnType<typeof useSessionDirectoryStore.getState>,
    | "clientSessionIdByMaterializedSessionId"
    | "entriesById"
    | "promotedRootSessionIds"
    | "promotedRootWorkspaceIdBySessionId"
    | "relationshipHintsBySessionId"
  >,
  childSessionId: string,
): {
  clientSessionId: string;
  relationship: SessionRelationship | null;
  workspaceId: string | null;
} {
  const clientSessionId =
    directory.clientSessionIdByMaterializedSessionId[childSessionId]
    ?? childSessionId;
  const entry = directory.entriesById[clientSessionId];
  const isPromoted = directory.promotedRootSessionIds.has(childSessionId)
    || directory.promotedRootSessionIds.has(clientSessionId);
  if (isPromoted) {
    return {
      clientSessionId,
      relationship: ROOT_SESSION_RELATIONSHIP,
      workspaceId: entry?.workspaceId
        ?? directory.promotedRootWorkspaceIdBySessionId[clientSessionId]
        ?? directory.promotedRootWorkspaceIdBySessionId[childSessionId]
        ?? null,
    };
  }
  const relationship = entry?.sessionRelationship.kind === "pending"
    ? directory.relationshipHintsBySessionId[clientSessionId]
      ?? directory.relationshipHintsBySessionId[childSessionId]
      ?? entry.sessionRelationship
    : entry?.sessionRelationship
      ?? directory.relationshipHintsBySessionId[clientSessionId]
      ?? directory.relationshipHintsBySessionId[childSessionId]
      ?? null;
  const relationshipWorkspaceId = relationship
    && "workspaceId" in relationship
      ? relationship.workspaceId ?? null
      : null;
  return {
    clientSessionId,
    relationship,
    workspaceId: entry?.workspaceId ?? relationshipWorkspaceId,
  };
}

/**
 * Opens a durable subagent route inside the Agents tool without selecting a
 * chat tab. Callers must already have authoritative current-workspace
 * subagent provenance; ordinary/promoted/cowork/review targets keep their
 * existing session-navigation paths.
 */
export function useAgentsPaneNavigationActions() {
  const shellActions = useWorkspaceShellActions();
  const selectedWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedWorkspaceId,
  );
  const openClusterRoute = useAgentsPaneNavigationStore((state) => state.openCluster);
  const openDetailRoute = useAgentsPaneNavigationStore((state) => state.openDetail);

  const resolveAgentsPaneTarget = useCallback((
    target: AgentsPaneNavigationTarget,
  ): AgentsPaneTargetResolution => {
    if (!target.childSessionId) {
      return {
        classification: "subagent",
        clientSessionId: null,
        relationship: null,
        workspaceId: target.workspaceId,
      };
    }
    const directory = useSessionDirectoryStore.getState();
    const current = resolveCurrentSessionRelationship(directory, target.childSessionId);
    const childClientSessionId = current.clientSessionId;
    const entry = directory.entriesById[childClientSessionId];
    if (
      directory.promotedRootSessionIds.has(target.childSessionId)
      || directory.promotedRootSessionIds.has(childClientSessionId)
    ) {
      return {
        classification: "promoted",
        clientSessionId: childClientSessionId,
        relationship: ROOT_SESSION_RELATIONSHIP,
        workspaceId: entry?.workspaceId
          ?? directory.promotedRootWorkspaceIdBySessionId[childClientSessionId]
          ?? directory.promotedRootWorkspaceIdBySessionId[target.childSessionId]
          ?? target.workspaceId,
      };
    }
    const currentRelationship = current.relationship;
    let classification: AgentsPaneTargetClassification;
    if (isDurableSubagentRelationship(currentRelationship)) {
      classification = "subagent";
    } else if (
      currentRelationship
      && currentRelationship.kind !== "pending"
      && currentRelationship.kind !== "root"
    ) {
      // Cowork, review, and non-subagent linked relationships always retain
      // their ordinary navigation even if an unrelated roster is stale.
      classification = "other_relationship";
    } else if (target.authoritativeCurrentRosterSubagent) {
      // A current roster response may correct a provisional root/pending slot.
      classification = "subagent";
    } else if (currentRelationship?.kind === "root") {
      classification = "other_relationship";
    } else if (
      currentRelationship?.kind === "pending"
      && target.historicalSubagentProvenance
      && current.workspaceId !== null
      && current.workspaceId === target.workspaceId
    ) {
      classification = "subagent";
    } else {
      classification = "unresolved";
    }
    return {
      classification,
      clientSessionId: childClientSessionId,
      relationship: currentRelationship ?? null,
      workspaceId: current.workspaceId
        ?? target.workspaceId,
    };
  }, []);

  const classifyAgentsPaneTarget = useCallback((target: AgentsPaneNavigationTarget) =>
    resolveAgentsPaneTarget(target).classification,
  [resolveAgentsPaneTarget]);

  const openAgentsPaneTarget = useCallback((target: AgentsPaneNavigationTarget) => {
    if (target.workspaceId !== selectedWorkspaceId || !shellActions) {
      return false;
    }
    if (classifyAgentsPaneTarget(target) !== "subagent") {
      return false;
    }
    if (target.childSessionId) {
      openDetailRoute(
        target.workspaceId,
        target.parentSessionId,
        target.childSessionId,
      );
    } else {
      openClusterRoute(target.workspaceId, target.parentSessionId);
    }
    shellActions.openRightPanelTool("agents");
    return true;
  }, [
    classifyAgentsPaneTarget,
    openClusterRoute,
    openDetailRoute,
    selectedWorkspaceId,
    shellActions,
  ]);

  return { classifyAgentsPaneTarget, openAgentsPaneTarget, resolveAgentsPaneTarget };
}
