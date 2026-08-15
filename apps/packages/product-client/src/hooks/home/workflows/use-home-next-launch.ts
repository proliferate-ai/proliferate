import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { promptAttachmentSnapshotsToContentParts } from "#product/domain/chats/composer/prompt-attachment-content-parts";
import type { PromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
import { useCreateCloudWorkspace } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";
import { useHomeNextLaunchPromptActions } from "#product/hooks/home/workflows/use-home-next-launch-prompt-actions";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import type { HomeLaunchTarget, HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";
import { useDeferredHomeLaunchStore } from "#product/stores/home/deferred-home-launch-store";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useCoworkThreadLaunchContext } from "#product/providers/CoworkThreadLaunchProvider";
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
  attachmentSnapshots?: PromptAttachmentSnapshot[];
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
  const { desktopTargetsAvailable, createThreadFromSelection } =
    useCoworkThreadLaunchContext();
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
    attachmentSnapshots,
    modelSelection,
    modeId,
    launchControlValues,
    target,
  }: HomeNextLaunchInput): Promise<boolean> => {
    const prompt = text.trim();
    if ((!prompt && !attachmentSnapshots?.length) || inFlightRef.current) {
      return false;
    }
    if (!desktopTargetsAvailable && target.kind !== "cloud") {
      const message = target.kind === "cowork"
        ? "Cowork threads are available in the Desktop app."
        : "Local launch targets are available in the Desktop app.";
      showToast(message, "info");
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
    // Blocks stay text-only here: prompt dispatch rebuilds them from the
    // snapshots at send time (see preparePromptBlocks).
    const attachmentContentParts =
      promptAttachmentSnapshotsToContentParts(attachmentSnapshots ?? []);
    beginLaunchIntent({
      id: launchIntentId,
      catalogSnapshotId: null,
      agentKind: modelSelection.kind,
      modelId: modelSelection.modelId,
      modeId,
      launchControlValues: resolvedLaunchControlValues,
      promptId,
      queuedPromptBlocks: prompt ? [{ type: "text", text: prompt }] : [],
      optimisticContentParts: [
        ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
        ...attachmentContentParts,
      ],
      text: prompt,
      contentParts: [
        ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
        ...attachmentContentParts,
      ],
      targetKind: target.kind,
      retryInput: {
        text: prompt,
        attachmentSnapshots,
        modelSelection,
        modeId,
        launchControlValues: resolvedLaunchControlValues,
        target,
      },
      materializedWorkspaceId: null,
      materializedSessionId: null,
      // The pending-workspace attempt (if any) isn't created until after this
      // intent begins; it gets threaded in once known via
      // markHomeLaunchIntentMaterializedFromPendingWorkspace.
      attemptId: null,
      targetWorkspaceId: target.kind === "local" ? target.existingWorkspaceId : null,
      createdAt: Date.now(),
      sendAttemptedAt: null,
      failure: null,
    });

    try {
      if (target.kind === "cowork") {
        const resultPromise = createThreadFromSelection({
          agentKind: modelSelection.kind,
          modelId: modelSelection.modelId,
          modeId,
          launchControlValues: resolvedLaunchControlValues,
          draftText: null,
          sourceWorkspaceId: null,
        });
        // createThreadFromSelection runs its synchronous prefix (including
        // beginPendingWorkspace) before its first await, so the pending
        // attempt already exists in the store here. Scope the intent to it
        // now instead of waiting for the catch block, so the launch-intent
        // pane owns its own shell for the whole in-flight window instead of
        // falling through to session-empty (PRO-230 review finding 1).
        markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId);
        const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
          text: prompt,
          attachmentSnapshots,
          promptId,
          launchIntentId,
          waitUntil: resultPromise,
        });
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const result = await resultPromise;
        if (!result) {
          throw new Error("Cowork thread creation was interrupted.");
        }
        if (!queuedProjectedSessionId) {
          navigate("/");
        }
        const projectedSessionId = queuedProjectedSessionId ?? result.projectedSessionId ?? null;
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId: result.workspace.id,
          sessionId: result.session.id,
          clientSessionId: projectedSessionId,
        });

        if (!queuedProjectedSessionId) {
          await promptExistingSession({
            sessionId: projectedSessionId ?? result.session.id,
            text: prompt,
            attachmentSnapshots,
            workspaceId: result.workspace.id,
            promptId,
            launchIntentId,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      if (target.kind === "local") {
        const createdWorkspacePromise = target.existingWorkspaceId
          ? null
          : createLocalWorkspaceAndEnterWithResult(target.sourceRoot, {
            repoGroupKeyToExpand: target.sourceRoot,
            initialSession,
          });
        if (createdWorkspacePromise) {
          // Same reasoning as the cowork branch: the create call's synchronous
          // prefix (beginPendingWorkspace) has already run, so scope the
          // intent to the pending attempt now rather than only on failure.
          markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId);
        }
        const queuedProjectedSessionId = createdWorkspacePromise
          ? await promptProjectedPendingWorkspaceSession({
            text: prompt,
            attachmentSnapshots,
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
            attachmentSnapshots,
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
        // Same reasoning as the cowork/local branches above: the pending
        // attempt already exists synchronously, so scope the intent now.
        markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId);
        const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
          text: prompt,
          attachmentSnapshots,
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
            attachmentSnapshots,
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
        attachmentSnapshots,
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
    createThreadFromSelection,
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
