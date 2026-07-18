import type { ProductStorageContext } from "#product/lib/infra/persistence/product-storage";
import type { CreateEmptySessionWithResolvedConfigOptions } from "#product/hooks/sessions/workflows/session-creation-types";
import { elapsedMs, logLatency } from "#product/lib/infra/measurement/measurement-port";
import { markWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";

type PendingEmptySessionCreationWorkflow = Pick<
  typeof import("#product/hooks/sessions/workflows/pending-empty-session-creation"),
  "resumePendingEmptySessionCreations"
>;

interface ResumePendingEmptySessionCreationInput {
  storageContext: ProductStorageContext;
  workspaceId: string;
  startedAt: number;
  isCurrent: () => boolean;
  createEmptySession: (
    options: CreateEmptySessionWithResolvedConfigOptions,
  ) => Promise<string>;
  loadWorkflow?: () => Promise<PendingEmptySessionCreationWorkflow>;
}

const loadPendingEmptySessionCreationWorkflow = () => import(
  "#product/hooks/sessions/workflows/pending-empty-session-creation"
);

/** Returns true when bootstrap must stop after resuming or losing ownership. */
export async function resumePendingEmptySessionCreationForBootstrap({
  storageContext,
  workspaceId,
  startedAt,
  isCurrent,
  createEmptySession,
  loadWorkflow = loadPendingEmptySessionCreationWorkflow,
}: ResumePendingEmptySessionCreationInput): Promise<boolean> {
  let workflow: PendingEmptySessionCreationWorkflow;
  try {
    workflow = await loadWorkflow();
  } catch (error) {
    storageContext.captureException(error, {
      tags: {
        domain: "pending_empty_session_creation",
        action: "load_workflow",
      },
    });
    if (isCurrent()) {
      // Loading a stale deployment chunk has an unknown recovery outcome. Keep
      // the workspace usable, but fail closed instead of creating a second
      // default session while a durable intent may still exist.
      markWorkspaceBootstrappedInSession(workspaceId);
    }
    return true;
  }
  const { resumePendingEmptySessionCreations } = workflow;
  const { resumed, unresolved } = await resumePendingEmptySessionCreations(
    storageContext,
    workspaceId,
    isCurrent,
    createEmptySession,
  );
  if (!isCurrent()) {
    return true;
  }
  if (resumed === 0 && unresolved === 0) {
    return false;
  }
  logLatency("workspace.select.pending_session_creation_resumed", {
    workspaceId,
    resumedCount: resumed,
    unresolvedCount: unresolved,
    totalElapsedMs: elapsedMs(startedAt),
  });
  markWorkspaceBootstrappedInSession(workspaceId);
  return true;
}
