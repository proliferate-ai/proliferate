import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
import { useHomeNextLaunchPromptActions } from "#product/hooks/home/workflows/use-home-next-launch-prompt-actions";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import type {
  HomeLaunchTarget,
  HomeNextLaunchOutcome,
  HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import {
  createPendingWorkspaceAttemptId,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  launchSubmitFingerprint,
  type LaunchSubmitFingerprint,
} from "#product/lib/domain/workspaces/creation/launch-concurrency";
import {
  pendingWorkspaceFailureNoticeOwnsFailure,
} from "#product/hooks/workspaces/workflows/pending-workspace-failure-notice";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useCoworkThreadLaunchContext } from "#product/providers/CoworkThreadLaunchProvider";
import {
  beginHomeNextLaunch,
  describeHomeLaunchTarget,
  homeLaunchFailureRetryMode,
  homeNextLaunchErrorMessage,
  markHomeLaunchIntentMaterializedFromPendingWorkspace,
  resolveHomeNextLaunchRefusal,
} from "#product/hooks/home/workflows/home-next-launch-intent";

interface HomeNextLaunchInput {
  text: string;
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  modelSelection: HomeNextModelSelection;
  launchControlValues?: Record<string, string>;
  target: HomeLaunchTarget;
}

// Owns the Home Next submit action. Does not own read-only selection state or deferred launch replay.
export function useHomeNextLaunch() {
  const navigate = useNavigate();
  // A count, not a flag: with several launches in flight the first one to
  // settle used to clear the send spinner and re-enable Escape-to-clear while
  // the others were still running (PRO-230 review nit).
  const [launchingCount, setLaunchingCount] = useState(0);
  // Was an in-flight lock, which refused every second launch. Now it only
  // remembers the last submit, so the identical prompt sent twice in a
  // keystroke still collapses into one launch while two different prompts
  // start two (PRO-230).
  const lastSubmitRef = useRef<LaunchSubmitFingerprint | null>(null);
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
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
  const { selectWorkspace } = useWorkspaceSelection();

  const launch = useCallback(async ({
    text,
    attachmentSnapshots,
    modelSelection,
    launchControlValues,
    target,
  }: HomeNextLaunchInput): Promise<HomeNextLaunchOutcome> => {
    const prompt = text.trim();
    const submit = launchSubmitFingerprint(prompt, target, Date.now());
    const refusal = resolveHomeNextLaunchRefusal({
      prompt,
      target,
      submit,
      lastSubmit: lastSubmitRef.current,
      desktopTargetsAvailable,
      pendingWorkspaces: useSessionSelectionStore.getState().pendingWorkspaces,
    });
    if (refusal) {
      if (refusal.message) {
        showToast(refusal.message, "info");
      }
      return refusal.outcome;
    }

    lastSubmitRef.current = submit;
    setLaunchingCount((count) => count + 1);
    const {
      launchIntentId,
      promptId,
      resolvedLaunchControlValues,
      initialSession,
    } = beginHomeNextLaunch(beginLaunchIntent, {
      prompt,
      modelSelection,
      launchControlValues,
      target,
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
          attachmentSnapshots,
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
          return "not-started";
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
        clearLaunchIntent(launchIntentId);
        return "launched";
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
            attachmentSnapshots,
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
          return "not-started";
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
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            attachmentSnapshots,
            promptId,
            launchIntentId,
            allowFreshFallback: target.existingWorkspaceId !== null,
          });
        }
        clearLaunchIntent(launchIntentId);
        return "launched";
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
          attachmentSnapshots,
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
          return "not-started";
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
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            attachmentSnapshots,
            promptId,
            launchIntentId,
            allowFreshFallback: false,
          });
        }
        clearLaunchIntent(launchIntentId);
        return "launched";
      }

      // The cloud sandbox stack is deleted: a cloud target can no longer be
      // launched. The target catalog no longer offers one, so this arm only
      // guards a stale selection; the shared catch owns the failure toast.
      throw new Error("Cloud workspaces are no longer available.");
    } catch (error) {
      markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId, launchAttemptId);
      failLaunchIntent(launchIntentId, {
        message: homeNextLaunchErrorMessage(error),
        retryMode: homeLaunchFailureRetryMode(launchIntentId, launchAttemptId),
      });
      // No Retry here: the Home composer puts the prompt back in the editor
      // when the launch does not start, so the composer's own send button is
      // the retry. A second entry point would leave a duplicate draft behind.
      //
      // And no toast at all when the attempt's own failure notice already
      // raised one: an unattended failure otherwise stacked two error toasts
      // for one event, the second of which claims the prompt is back in a
      // composer the user is not looking at (PRO-230 review finding 5).
      if (!pendingWorkspaceFailureNoticeOwnsFailure(launchAttemptId)) {
        showErrorToast({
          headline: "Work not started",
          consequence:
            `Nothing was started on ${describeHomeLaunchTarget(target)}. Your prompt is back in the composer.`,
          cause: homeNextLaunchErrorMessage(error),
        });
      }
      return "not-started";
    } finally {
      setLaunchingCount((count) => count - 1);
    }
  }, [
    beginLaunchIntent,
    clearLaunchIntent,
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
    createLocalWorkspaceAndEnterWithResult,
    createThreadFromSelection,
    createWorktreeAndEnterWithResult,
    desktopTargetsAvailable,
    failLaunchIntent,
    markLaunchIntentMaterialized,
    navigate,
    promptExistingSession,
    selectWorkspace,
    showErrorToast,
    showToast,
  ]);

  return { isLaunching: launchingCount > 0, launch };
}
