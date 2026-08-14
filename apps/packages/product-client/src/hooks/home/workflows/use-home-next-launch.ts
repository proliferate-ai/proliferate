import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateCloudWorkspace } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";
import { useHomeNextLaunchPromptActions } from "#product/hooks/home/workflows/use-home-next-launch-prompt-actions";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import type { HomeLaunchTarget, HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";
import {
  createPendingWorkspaceAttemptId,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  canBeginPendingLaunch,
  isDuplicateLaunchSubmit,
  launchSubmitFingerprint,
  type LaunchSubmitFingerprint,
} from "#product/lib/domain/workspaces/creation/launch-concurrency";
import {
  pendingWorkspaceEntries,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
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
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  launchControlValues?: Record<string, string>;
  target: HomeLaunchTarget;
}

// Owns the Home Next submit action. Does not own read-only selection state or deferred launch replay.
export function useHomeNextLaunch() {
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  // Was an in-flight lock, which refused every second launch. Now it only
  // remembers the last submit, so the identical prompt sent twice in a
  // keystroke still collapses into one launch while two different prompts
  // start two (PRO-230).
  const lastSubmitRef = useRef<LaunchSubmitFingerprint | null>(null);
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const enqueueDeferredLaunch = useDeferredHomeLaunchStore((state) => state.enqueue);
  const beginLaunchIntent = useChatLaunchIntentStore((state) => state.begin);
  const clearLaunchIntent = useChatLaunchIntentStore((state) => state.clear);
  const failLaunchIntent = useChatLaunchIntentStore((state) => state.fail);
  const markLaunchIntentMaterialized =
    useChatLaunchIntentStore((state) => state.markMaterialized);
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
    modelSelection,
    modeId,
    launchControlValues,
    target,
  }: HomeNextLaunchInput): Promise<boolean> => {
    const prompt = text.trim();
    if (!prompt) {
      return false;
    }
    const submit = launchSubmitFingerprint(prompt, Date.now());
    if (isDuplicateLaunchSubmit(lastSubmitRef.current, submit)) {
      return false;
    }
    if (!desktopTargetsAvailable && target.kind !== "cloud") {
      const message = target.kind === "cowork"
        ? "Cowork threads are available in the Desktop app."
        : "Local launch targets are available in the Desktop app.";
      showToast(message, "info");
      return false;
    }
    // Prompting an existing workspace starts no workspace, so it takes no
    // launch slot and the cap does not apply to it.
    const createsWorkspace = target.kind !== "local" || target.existingWorkspaceId === null;
    if (
      createsWorkspace
      && !canBeginPendingLaunch(
        pendingWorkspaceEntries(useSessionSelectionStore.getState().pendingWorkspaces),
      )
    ) {
      showToast("Too many workspaces starting. Wait for one to finish.", "info");
      return false;
    }

    lastSubmitRef.current = submit;
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
      // The pending-workspace attempt (if any) isn't created until after this
      // intent begins; it gets threaded in once known via
      // markHomeLaunchIntentMaterializedFromPendingWorkspace.
      attemptId: null,
      targetWorkspaceId: target.kind === "local" ? target.existingWorkspaceId : null,
      createdAt: Date.now(),
      sendAttemptedAt: null,
      failure: null,
    });

    // Minted per target branch below; the catch needs it to scope failure state
    // to this launch's own attempt.
    let launchAttemptId: string | null = null;

    try {
      if (target.kind === "cowork") {
        const attemptId = createPendingWorkspaceAttemptId();
        launchAttemptId = attemptId;
        const resultPromise = createThreadFromSelection({
          attemptId,
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
        // Pass the pre-minted attemptId explicitly (registry lookup) rather
        // than relying on the attended/selected entry.
        markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId, attemptId);
        const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
          text: prompt,
          promptId,
          launchIntentId,
          waitUntil: resultPromise,
          attemptId,
        });
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const result = await resultPromise;
        if (!result) {
          // The user dismissed the pending thread. Nothing failed, so the
          // launch stops quietly instead of raising a "not started" toast,
          // matching the local and worktree branches below.
          clearLaunchIntent(launchIntentId);
          return false;
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
            workspaceId: result.workspace.id,
            promptId,
            launchIntentId,
          });
        }
        clearLaunchIntent(launchIntentId);
        return true;
      }

      if (target.kind === "local") {
        const attemptId = createPendingWorkspaceAttemptId();
        launchAttemptId = target.existingWorkspaceId ? null : attemptId;
        const createdWorkspacePromise = target.existingWorkspaceId
          ? null
          : createLocalWorkspaceAndEnterWithResult(target.sourceRoot, {
            attemptId,
            repoGroupKeyToExpand: target.sourceRoot,
            initialSession,
          });
        if (createdWorkspacePromise) {
          // Same reasoning as the cowork branch: the create call's synchronous
          // prefix (beginPendingWorkspace) has already run, so scope the
          // intent to the pending attempt now rather than only on failure.
          // Pass the pre-minted attemptId explicitly (registry lookup) rather
          // than relying on the attended/selected entry.
          markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId, attemptId);
        }
        const queuedProjectedSessionId = createdWorkspacePromise
          ? await promptProjectedPendingWorkspaceSession({
            text: prompt,
            promptId,
            launchIntentId,
            waitUntil: createdWorkspacePromise,
            attemptId,
          })
          : null;
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const createdWorkspace = createdWorkspacePromise
          ? await createdWorkspacePromise
          : null;
        if (createdWorkspacePromise && !createdWorkspace) {
          // The user dismissed the pending workspace. Nothing failed, so the
          // launch stops quietly instead of raising a "not started" toast.
          clearLaunchIntent(launchIntentId);
          return false;
        }
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
        clearLaunchIntent(launchIntentId);
        return true;
      }

      if (target.kind === "worktree") {
        const attemptId = createPendingWorkspaceAttemptId();
        launchAttemptId = attemptId;
        const createdWorkspacePromise = createWorktreeAndEnterWithResult({
          repoRootId: target.repoRootId,
          sourceWorkspaceId: target.sourceWorkspaceId,
          baseBranch: target.baseBranch,
          defaultBranch: target.defaultBranch,
        }, {
          attemptId,
          initialSession,
        });
        // Same reasoning as the cowork/local branches above: the pending
        // attempt already exists synchronously, so scope the intent now.
        // Pass the pre-minted attemptId explicitly (registry lookup) rather
        // than relying on the attended/selected entry.
        markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId, attemptId);
        const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
          text: prompt,
          promptId,
          launchIntentId,
          waitUntil: createdWorkspacePromise,
          attemptId,
        });
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const createdWorkspace = await createdWorkspacePromise;
        if (!createdWorkspace) {
          // The user dismissed the pending worktree. Nothing failed, so the
          // launch stops quietly instead of raising a "not started" toast.
          clearLaunchIntent(launchIntentId);
          return false;
        }
        const { workspaceId, projectedSessionId: createdProjectedSessionId } = createdWorkspace;
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
        clearLaunchIntent(launchIntentId);
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
        clearLaunchIntent,
        enqueueDeferredLaunch,
        navigate,
        showToast,
      });
    } catch (error) {
      markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId, launchAttemptId);
      failLaunchIntent(launchIntentId, {
        message: homeNextLaunchErrorMessage(error),
        retryMode: homeLaunchFailureRetryMode(launchIntentId, launchAttemptId),
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
      setIsLaunching(false);
    }
  }, [
    beginLaunchIntent,
    clearLaunchIntent,
    createCloudWorkspaceAndEnterWithResult,
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
    createLocalWorkspaceAndEnterWithResult,
    createThreadFromSelection,
    createWorktreeAndEnterWithResult,
    desktopTargetsAvailable,
    enqueueDeferredLaunch,
    failLaunchIntent,
    markLaunchIntentMaterialized,
    navigate,
    promptExistingSession,
    selectWorkspace,
    showErrorToast,
    showToast,
  ]);

  return { isLaunching, launch };
}
