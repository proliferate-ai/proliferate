import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateCloudWorkspace } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";
import { useHomeNextLaunchPromptActions } from "#product/hooks/home/workflows/use-home-next-launch-prompt-actions";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import type { HomeLaunchTarget, HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";
import { useDeferredHomeLaunchStore } from "#product/stores/home/deferred-home-launch-store";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { launchHomeCloudTarget } from "#product/hooks/home/workflows/launch-home-cloud-target";
import {
  buildHomePendingWorkspaceInitialSession,
  buildResolvedHomeLaunchControlValues,
  describeHomeLaunchTarget,
  homeLaunchFailureRetryMode,
  homeNextLaunchErrorMessage,
  markHomeLaunchIntentMaterializedFromPendingWorkspace,
  newHomeNextLaunchId,
} from "#product/hooks/home/workflows/home-next-launch-intent";

interface HomeNextLaunchInput {
  text: string;
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  launchControlValues?: Record<string, string>;
  target: HomeLaunchTarget;
}

// Owns the Home Next submit action. Does not own read-only selection state or deferred launch replay.
export function useHomeNextLaunch() {
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const inFlightRef = useRef(false);
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const enqueueDeferredLaunch = useDeferredHomeLaunchStore((state) => state.enqueue);
  const beginLaunchIntent = useChatLaunchIntentStore((state) => state.begin);
  const clearLaunchIntentIfActive = useChatLaunchIntentStore((state) => state.clearIfActive);
  const failLaunchIntentIfActive = useChatLaunchIntentStore((state) => state.failIfActive);
  const markLaunchIntentMaterialized =
    useChatLaunchIntentStore((state) => state.markMaterializedIfActive);
  const desktopTargetsAvailable = useProductHost().desktop !== null;
  const {
    promptExistingSession,
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
  } = useHomeNextLaunchPromptActions();
  const {
    createLocalWorkspaceAndEnterWithResult,
    createWorktreeAndEnterWithResult,
  } = useWorkspaceEntryActions();
  const { createCloudWorkspaceAndEnterWithResult } = useCreateCloudWorkspace();
  const { selectWorkspace } = useWorkspaceSelection();

  const launch = useCallback(async ({
    text,
    modelSelection,
    modeId,
    launchControlValues,
    target,
  }: HomeNextLaunchInput): Promise<boolean> => {
    const prompt = text.trim();
    if (!prompt || inFlightRef.current) {
      return false;
    }
    if (!desktopTargetsAvailable && target.kind !== "cloud") {
      showToast("Local launch targets are available in the Desktop app.", "info");
      return false;
    }

    inFlightRef.current = true;
    setIsLaunching(true);
    const launchIntentId = newHomeNextLaunchId();
    const promptId = newHomeNextLaunchId();
    const resolvedLaunchControlValues = buildResolvedHomeLaunchControlValues({
      modeId,
      launchControlValues,
    });
    const initialSession = buildHomePendingWorkspaceInitialSession({
      modelSelection,
      modeId,
      launchControlValues: resolvedLaunchControlValues,
    });
    beginLaunchIntent({
      id: launchIntentId,
      catalogSnapshotId: null,
      agentKind: modelSelection.kind,
      modelId: modelSelection.modelId,
      modeId,
      launchControlValues: resolvedLaunchControlValues,
      promptId,
      queuedPromptBlocks: [{ type: "text", text: prompt }],
      optimisticContentParts: [{ type: "text", text: prompt }],
      text: prompt,
      contentParts: [{ type: "text", text: prompt }],
      targetKind: target.kind,
      retryInput: {
        text: prompt,
        modelSelection,
        modeId,
        launchControlValues: resolvedLaunchControlValues,
        target,
      },
      materializedWorkspaceId: null,
      materializedSessionId: null,
      createdAt: Date.now(),
      sendAttemptedAt: null,
      failure: null,
    });

    try {
      if (target.kind === "local") {
        const createdWorkspacePromise = target.existingWorkspaceId
          ? null
          : createLocalWorkspaceAndEnterWithResult(target.sourceRoot, {
            repoGroupKeyToExpand: target.sourceRoot,
            initialSession,
          });
        const queuedProjectedSessionId = createdWorkspacePromise
          ? await promptProjectedPendingWorkspaceSession({
            text: prompt,
            promptId,
            launchIntentId,
            waitUntil: createdWorkspacePromise,
          })
          : null;
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const createdWorkspace = createdWorkspacePromise
          ? await createdWorkspacePromise
          : null;
        const workspaceId = target.existingWorkspaceId ?? createdWorkspace?.workspaceId;
        if (!workspaceId) {
          throw new Error("Workspace creation was interrupted.");
        }
        if (!queuedProjectedSessionId) {
          navigate("/");
        }
        const projectedSessionId =
          queuedProjectedSessionId ?? createdWorkspace?.projectedSessionId ?? null;
        if (!target.existingWorkspaceId) {
          markLaunchIntentMaterialized(launchIntentId, {
            workspaceId,
            clientSessionId: projectedSessionId,
          });
        }
        if (target.existingWorkspaceId) {
          await selectWorkspace(workspaceId, { force: true });
        }
        if (!queuedProjectedSessionId) {
          await promptProjectedOrCreateFreshSession({
            workspaceId,
            projectedSessionId,
            modelSelection,
            modeId,
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            promptId,
            launchIntentId,
            allowFreshFallback: target.existingWorkspaceId !== null,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      if (target.kind === "worktree") {
        const createdWorkspacePromise = createWorktreeAndEnterWithResult({
          repoRootId: target.repoRootId,
          sourceWorkspaceId: target.sourceWorkspaceId,
          baseBranch: target.baseBranch,
          defaultBranch: target.defaultBranch,
        }, {
          initialSession,
        });
        const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
          text: prompt,
          promptId,
          launchIntentId,
          waitUntil: createdWorkspacePromise,
        });
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const { workspaceId, projectedSessionId: createdProjectedSessionId } =
          await createdWorkspacePromise;
        if (!queuedProjectedSessionId) {
          navigate("/");
        }
        const projectedSessionId = queuedProjectedSessionId ?? createdProjectedSessionId;
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId,
          clientSessionId: projectedSessionId,
        });
        if (!queuedProjectedSessionId) {
          await promptProjectedOrCreateFreshSession({
            workspaceId,
            projectedSessionId,
            modelSelection,
            modeId,
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            promptId,
            launchIntentId,
            allowFreshFallback: false,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      return await launchHomeCloudTarget({
        target,
        prompt,
        promptId,
        launchIntentId,
        modelSelection,
        modeId,
        launchControlValues: resolvedLaunchControlValues,
        initialSession,
        createdAt: Date.now(),
      }, {
        createCloudWorkspaceAndEnterWithResult,
        promptProjectedPendingWorkspaceSession,
        promptProjectedOrCreateFreshSession,
        markLaunchIntentMaterialized,
        clearLaunchIntentIfActive,
        enqueueDeferredLaunch,
        navigate,
        showToast,
      });
    } catch (error) {
      markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId);
      failLaunchIntentIfActive(launchIntentId, {
        message: homeNextLaunchErrorMessage(error),
        retryMode: homeLaunchFailureRetryMode(launchIntentId),
      });
      // No Retry here: the Home composer puts the prompt back in the editor
      // when `launch` returns false, so the composer's own send button is the
      // retry. A second entry point would leave a duplicate draft behind.
      showErrorToast({
        headline: "Work not started",
        consequence:
          `Nothing was started on ${describeHomeLaunchTarget(target)}. Your prompt is back in the composer.`,
        cause: homeNextLaunchErrorMessage(error),
      });
      return false;
    } finally {
      inFlightRef.current = false;
      setIsLaunching(false);
    }
  }, [
    beginLaunchIntent,
    clearLaunchIntentIfActive,
    createCloudWorkspaceAndEnterWithResult,
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
    createLocalWorkspaceAndEnterWithResult,
    createWorktreeAndEnterWithResult,
    desktopTargetsAvailable,
    enqueueDeferredLaunch,
    failLaunchIntentIfActive,
    markLaunchIntentMaterialized,
    navigate,
    promptExistingSession,
    selectWorkspace,
    showErrorToast,
    showToast,
  ]);

  return { isLaunching, launch };
}
