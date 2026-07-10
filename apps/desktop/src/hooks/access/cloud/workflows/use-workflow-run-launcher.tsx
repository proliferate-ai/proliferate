import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import {
  deriveLastUsedTarget,
  resolveChatOriginTarget,
  withCurrentSessionCandidate,
  type WorkflowRunTargetRecord,
  type WorkflowSessionCandidateInput,
} from "@proliferate/product-domain/workflows/run-launch";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import { useWorkflowRuns } from "@/hooks/access/cloud/workflows/use-workflows";
import { useLaunchWorkflowRun } from "@/hooks/access/cloud/workflows/use-launch-workflow-run";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useWorkflowRunPillStore } from "@/stores/workflows/workflow-run-pill-store";
import type { WorkflowResponse } from "@/hooks/access/cloud/workflows/types";
import {
  WorkflowRunArgsModal,
  type WorkflowRunSubmit,
  type WorkflowRunTargetOption,
} from "@/components/workflows/home/WorkflowRunArgsModal";

// Mirrors gateway_grants.py's L22 fail-fast code (see WorkflowsHomeScreen).
const FUNCTION_PROVIDER_NOT_READY_CODE = "workflow_function_provider_not_ready";

/** The composer door's context (spec run-from-chat R1 door 1, gaps ①/②):
 * the chat the "run a workflow" affordance was opened from. `workspaceId` is
 * in the same id space as `localWorkspaceOptions`/`cloudWorkspaceOptions`
 * (raw local id, or raw cloud id for `personal_cloud`). */
export interface WorkflowChatOrigin {
  sessionId: string;
  title: string | null;
  harness: string;
  targetMode: WorkflowTargetMode;
  workspaceId: string;
}

interface LauncherState {
  workflow: WorkflowResponse;
  definition: WorkflowDefinition;
  chatOrigin: WorkflowChatOrigin | null;
}

export interface WorkflowRunLauncher {
  /** Open the launch modal for a workflow (any of the R1 doors). `chatOrigin`
   * is set only by the composer's lightning-bolt door — it pins the target
   * to the chat's own workspace (no picker) and offers the current session
   * as a bind candidate. */
  open: (
    workflow: WorkflowResponse,
    definition: WorkflowDefinition,
    chatOrigin?: WorkflowChatOrigin,
  ) => void;
  /** The modal element — render it once wherever the launcher is used. */
  modal: ReactNode;
  isPending: boolean;
}

/**
 * Shared launch controller behind all three run-from-chat doors (spec R1). Owns
 * the launch modal, run-target options, R6 last-used prefill, session bindings,
 * and the R2 stay-put run pill. Callers just `open(...)` and render `modal`.
 */
export function useWorkflowRunLauncher(): WorkflowRunLauncher {
  const navigate = useNavigate();
  const [state, setState] = useState<LauncherState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const runsQuery = useWorkflowRuns(null);
  const workspacesQuery = useWorkspaces();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const launchMutation = useLaunchWorkflowRun();
  const showRunPill = useWorkflowRunPillStore((store) => store.show);

  const runs = runsQuery.data?.runs ?? [];

  const localWorkspaceOptions = useMemo<WorkflowRunTargetOption[]>(
    () =>
      (workspacesQuery.data?.localWorkspaces ?? []).map((workspace) => ({
        id: workspace.id,
        label: workspace.displayName || workspace.currentBranch || workspace.path,
      })),
    [workspacesQuery.data],
  );
  const cloudWorkspaceOptions = useMemo<WorkflowRunTargetOption[]>(
    () =>
      (cloudTargetsQuery.data ?? [])
        .filter((workspace) => workspace.status === "ready")
        .map((workspace) => ({
          id: workspace.id,
          label: workspace.displayName ?? workspace.repo.branch,
        })),
    [cloudTargetsQuery.data],
  );

  const runTargetRecords = useMemo<WorkflowRunTargetRecord[]>(
    () =>
      runs.map((run) => ({
        workflowId: run.workflowId,
        createdAt: run.startedAt ?? run.createdAt,
        targetMode: (run.targetMode as WorkflowTargetMode) ?? "local",
        workspaceId: run.anyharnessWorkspaceId,
      })),
    [runs],
  );

  // Gap② — bind-existing candidates: the sessions read the app already has
  // (the client session directory — same source `useSupportReportSnapshot`
  // and the workspace tab strip use for "live sessions on this workspace").
  // Not-held filtering is out of scope here: no client-side read of a
  // session's held-by-run status exists yet (server enforces it at submit,
  // B8/L29); an actually-held pick surfaces as a launch error instead.
  const directoryEntries = useSessionDirectoryStore((storeState) => storeState.entriesById);
  const liveSessionCandidates = useMemo<WorkflowSessionCandidateInput[]>(
    () =>
      Object.values(directoryEntries)
        .filter((entry) => entry.status !== "closed")
        .map((entry) => ({
          id: entry.sessionId,
          title: entry.title ?? "Untitled session",
          harness: entry.agentKind,
          workspaceId: entry.workspaceId,
        })),
    [directoryEntries],
  );

  const open = (
    workflow: WorkflowResponse,
    definition: WorkflowDefinition,
    chatOrigin?: WorkflowChatOrigin,
  ) => {
    setError(null);
    setErrorCode(null);
    setState({ workflow, definition, chatOrigin: chatOrigin ?? null });
  };

  const runNow = (workflow: WorkflowResponse, submit: WorkflowRunSubmit) => {
    setError(null);
    setErrorCode(null);
    launchMutation.mutate(
      {
        workflowId: workflow.id,
        args: submit.args,
        targetMode: submit.targetMode,
        localWorkspaceId: submit.localWorkspaceId,
        cloudWorkspaceId: submit.cloudWorkspaceId,
        sessionBindings: submit.sessionBindings,
      },
      {
        onSuccess: (run) => {
          setState(null);
          showRunPill({ runId: run.id, workflowId: workflow.id, workflowName: workflow.name });
        },
        onError: (launchError) => {
          setError(launchError.message);
          setErrorCode(launchError instanceof ProliferateClientError ? launchError.code : null);
        },
      },
    );
  };

  const modal = state
    ? (() => {
        const lastUsed = deriveLastUsedTarget(runTargetRecords, state.workflow.id);
        const chatOrigin = state.chatOrigin;
        // Gap① — chat-origin target always wins over R6 last-used (spec:
        // "chat origin: implicit ... no picker row rendered").
        const resolvedTarget = resolveChatOriginTarget(
          chatOrigin ? { targetMode: chatOrigin.targetMode, workspaceId: chatOrigin.workspaceId } : null,
          lastUsed,
        );
        const chatOriginLabel = chatOrigin
          ? (chatOrigin.targetMode === "local"
              ? localWorkspaceOptions.find((option) => option.id === chatOrigin.workspaceId)?.label
              : cloudWorkspaceOptions.find((option) => option.id === chatOrigin.workspaceId)?.label)
            ?? "this workspace"
          : null;
        // Gap② — the current session goes first among same-harness bind
        // candidates (spec: "current session appears as a binding candidate
        // for the matching agent slot").
        const sessionCandidates = withCurrentSessionCandidate(
          liveSessionCandidates,
          chatOrigin
            ? {
                sessionId: chatOrigin.sessionId,
                title: chatOrigin.title ?? "This session",
                harness: chatOrigin.harness,
                workspaceId: chatOrigin.workspaceId,
              }
            : null,
        );
        return (
          <WorkflowRunArgsModal
            open
            workflowName={state.workflow.name}
            args={state.definition.inputs}
            slots={state.definition.agents.map((agent) => ({
              slot: agent.slot,
              harness: agent.harness,
              model: agent.model,
            }))}
            sessionCandidates={sessionCandidates}
            localWorkspaces={localWorkspaceOptions}
            cloudWorkspaces={cloudWorkspaceOptions}
            defaultTargetMode={resolvedTarget?.targetMode ?? null}
            defaultLocalWorkspaceId={
              resolvedTarget?.targetMode === "local" ? resolvedTarget.workspaceId : null
            }
            defaultCloudWorkspaceId={
              resolvedTarget?.targetMode === "personal_cloud" ? resolvedTarget.workspaceId : null
            }
            chatOriginLabel={chatOriginLabel}
            hasIntegrations={state.definition.integrations.length > 0}
            busy={launchMutation.isPending}
            error={error}
            onOpenIntegrationsSettings={
              errorCode === FUNCTION_PROVIDER_NOT_READY_CODE
                ? () => navigate("/settings?section=integrations")
                : undefined
            }
            onClose={() => setState(null)}
            onSubmit={(submit) => runNow(state.workflow, submit)}
          />
        );
      })()
    : null;

  return { open, modal, isPending: launchMutation.isPending };
}
