import type { ProductStorageContext } from "#product/lib/infra/persistence/product-storage";
import type { CreateEmptySessionWithResolvedConfigOptions } from "#product/hooks/sessions/workflows/session-creation-types";
import { resumePendingEmptySessionCreations } from "#product/hooks/sessions/workflows/pending-empty-session-creation";
import { elapsedMs, logLatency } from "#product/lib/infra/measurement/measurement-port";
import { markWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";

interface ResumePendingEmptySessionCreationInput {
  storageContext: ProductStorageContext;
  workspaceId: string;
  startedAt: number;
  isCurrent: () => boolean;
  createEmptySession: (
    options: CreateEmptySessionWithResolvedConfigOptions,
  ) => Promise<string>;
}

/** Returns true when bootstrap must stop after resuming or losing ownership. */
export async function resumePendingEmptySessionCreationForBootstrap({
  storageContext,
  workspaceId,
  startedAt,
  isCurrent,
  createEmptySession,
}: ResumePendingEmptySessionCreationInput): Promise<boolean> {
  const resumed = await resumePendingEmptySessionCreations(
    storageContext,
    workspaceId,
    isCurrent,
    createEmptySession,
  );
  if (!isCurrent()) {
    return true;
  }
  if (resumed === 0) {
    return false;
  }
  logLatency("workspace.select.pending_session_creation_resumed", {
    workspaceId,
    resumedCount: resumed,
    totalElapsedMs: elapsedMs(startedAt),
  });
  markWorkspaceBootstrappedInSession(workspaceId);
  return true;
}
