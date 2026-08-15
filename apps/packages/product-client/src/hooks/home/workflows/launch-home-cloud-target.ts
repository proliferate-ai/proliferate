import type { PromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
import type { CloudWorkspaceEntryResult } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";
import type {
  HomeLaunchTarget,
  HomeNextLaunchOutcome,
  HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import type { PendingWorkspaceInitialSession } from "#product/lib/domain/workspaces/creation/pending-entry";
import type { DeferredHomeLaunch } from "#product/stores/home/deferred-home-launch-store";
import { buildDeferredHomeLaunchId } from "#product/stores/home/deferred-home-launch-store";
import {
  markHomeLaunchIntentMaterializedFromPendingWorkspace,
} from "#product/hooks/home/workflows/home-next-launch-intent";
import { failLatencyFlow, startLatencyFlow } from "#product/lib/infra/measurement/measurement-port";

/** The cloud branch's slice of one launch call, passed in rather than re-derived. */
export interface LaunchHomeCloudTargetInput {
  target: Extract<HomeLaunchTarget, { kind: "cloud" }>;
  /**
   * Minted by the caller so this launch's intent, prompt routing and failure
   * handling all name the same attempt instead of resolving "the attended one".
   */
  attemptId: string;
  prompt: string;
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  promptId: string;
  launchIntentId: string;
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  launchControlValues: Record<string, string>;
  initialSession: PendingWorkspaceInitialSession;
  createdAt: number;
}

export interface LaunchHomeCloudTargetDeps {
  createCloudWorkspaceAndEnterWithResult: (
    target: { gitOwner: string; gitRepoName: string; baseBranch: string },
    options: {
      latencyFlowId: string;
      initialSession: PendingWorkspaceInitialSession;
      attemptId: string;
    },
  ) => Promise<CloudWorkspaceEntryResult>;
  promptProjectedPendingWorkspaceSession: (input: {
    text: string;
    attachmentSnapshots?: PromptAttachmentSnapshot[];
    promptId: string;
    launchIntentId: string;
    waitUntil?: Promise<unknown>;
    attemptId?: string | null;
  }) => Promise<string | null>;
  promptProjectedOrCreateFreshSession: (input: {
    workspaceId: string;
    projectedSessionId: string | null | undefined;
    modelSelection: HomeNextModelSelection;
    modeId: string | null;
    launchControlValues?: Record<string, string>;
    text: string;
    attachmentSnapshots?: PromptAttachmentSnapshot[];
    promptId: string;
    launchIntentId: string;
    allowFreshFallback?: boolean;
  }) => Promise<void>;
  markLaunchIntentMaterialized: (
    intentId: string,
    materialized: {
      clientSessionId?: string | null;
      workspaceId?: string | null;
      sessionId?: string | null;
    },
  ) => void;
  clearLaunchIntent: (intentId: string) => void;
  enqueueDeferredLaunch: (launch: DeferredHomeLaunch) => void;
  navigate: (to: string) => void;
  /** Only ever called with "info": this path's two outcomes are both queued, not failed. */
  showToast: (message: string, kind?: "info") => void;
}

const CLOUD_QUEUED_MESSAGE = "Prompt queued. It will send when the cloud workspace is ready.";

/**
 * Launches Home's cloud target.
 *
 * Extracted from `useHomeNextLaunch` because it is the one branch with three
 * outcomes — ready, shell-created-but-workspace-pending, and fully deferred —
 * and reading those three beside the three local target branches obscured all
 * six. Throws when the attempt is interrupted so the caller's single catch
 * still owns every failure toast.
 */
export async function launchHomeCloudTarget(
  input: LaunchHomeCloudTargetInput,
  deps: LaunchHomeCloudTargetDeps,
): Promise<HomeNextLaunchOutcome> {
  const latencyFlowId = startLatencyFlow({
    flowKind: "cloud_workspace_create",
    source: "home",
  });
  const resultPromise = deps.createCloudWorkspaceAndEnterWithResult(
    {
      gitOwner: input.target.gitOwner,
      gitRepoName: input.target.gitRepoName,
      baseBranch: input.target.baseBranch,
    },
    { latencyFlowId, initialSession: input.initialSession, attemptId: input.attemptId },
  );
  // Same reasoning as the cowork/local/worktree branches: the create call's
  // synchronous prefix has already registered the pending attempt, so scope the
  // intent to it now rather than only once the launch settles.
  markHomeLaunchIntentMaterializedFromPendingWorkspace(input.launchIntentId, input.attemptId);
  const queuedProjectedSessionId = await deps.promptProjectedPendingWorkspaceSession({
    text: input.prompt,
    attachmentSnapshots: input.attachmentSnapshots,
    promptId: input.promptId,
    launchIntentId: input.launchIntentId,
    waitUntil: resultPromise,
    attemptId: input.attemptId,
  });
  if (queuedProjectedSessionId) {
    deps.navigate("/");
  }
  const result = await resultPromise;
  if (result.status === "dismissed") {
    // The user dismissed the pending workspace. Nothing failed, so the launch
    // stops quietly instead of raising a "not started" toast.
    failLatencyFlow(latencyFlowId, "cloud_workspace_create_dismissed");
    deps.clearLaunchIntent(input.launchIntentId);
    return "not-started";
  }
  if (result.status === "interrupted") {
    failLatencyFlow(latencyFlowId, "cloud_workspace_create_interrupted");
    // Prefer the resolved server message (e.g. a billing gate 402) so the
    // toast shows why the launch failed instead of a generic string.
    throw new Error(result.failureMessage ?? "Cloud workspace creation was interrupted.");
  }
  if (!queuedProjectedSessionId) {
    deps.navigate("/");
  }

  const projectedSessionId = queuedProjectedSessionId ?? result.projectedSessionId;
  deps.markLaunchIntentMaterialized(input.launchIntentId, {
    workspaceId: result.workspaceId,
    clientSessionId: projectedSessionId,
  });

  if (result.status === "ready" || projectedSessionId) {
    // The prompt goes out once: when the pending-workspace path already sent
    // it, sending again here would duplicate the user's message.
    if (!queuedProjectedSessionId) {
      await deps.promptProjectedOrCreateFreshSession({
        workspaceId: result.workspaceId,
        projectedSessionId,
        modelSelection: input.modelSelection,
        modeId: input.modeId,
        launchControlValues: input.launchControlValues,
        text: input.prompt,
        attachmentSnapshots: input.attachmentSnapshots,
        promptId: input.promptId,
        launchIntentId: input.launchIntentId,
        allowFreshFallback: false,
      });
    }
    deps.clearLaunchIntent(input.launchIntentId);
    if (result.status !== "ready") {
      deps.showToast(CLOUD_QUEUED_MESSAGE, "info");
    }
    return "launched";
  }

  // No session shell to hold the prompt, so it waits on the deferred queue and
  // replays once the cloud workspace reports ready.
  deps.enqueueDeferredLaunch({
    id: buildDeferredHomeLaunchId({
      cloudWorkspaceId: result.cloudWorkspaceId,
      attemptId: result.attemptId,
    }),
    status: "pending",
    workspaceId: result.workspaceId,
    cloudWorkspaceId: result.cloudWorkspaceId,
    cloudAttemptId: result.attemptId,
    agentKind: input.modelSelection.kind,
    modelId: input.modelSelection.modelId,
    modeId: input.modeId,
    launchControlValues: input.launchControlValues,
    promptText: input.prompt,
    attachmentSnapshots: input.attachmentSnapshots,
    promptId: input.promptId,
    launchIntentId: input.launchIntentId,
    createdAt: input.createdAt,
  });
  deps.showToast(CLOUD_QUEUED_MESSAGE, "info");
  return "launched";
}
