import { navigateApp } from "#product/lib/workflows/app/app-navigate-handoff";
import { useToastStore } from "#product/stores/toast/toast-store";

/**
 * Tell the user about a queued prompt that failed to send into a workspace they
 * are not looking at.
 *
 * The attended failure already has the right words: the composer still holds
 * the text, so "your message is still in the composer" is both true and
 * actionable. A background promotion has neither — no composer holds the
 * prompt, and the workspace it was for is not on screen — so it gets its own
 * announcement: the workspace by name, and a way to open it. Keyed by
 * workspace so two failed background sends raise two toasts rather than
 * replacing each other (PRO-230).
 */
export function notifyQueuedPromptSendFailure(input: {
  workspaceId: string;
  workspaceName: string | null;
  cause: string;
  showWorkspace: () => void;
}): void {
  useToastStore.getState().showError({
    id: `queued-prompt-failure:${input.workspaceId}`,
    headline: "Queued prompt not sent",
    consequence: input.workspaceName
      ? `${input.workspaceName} is ready, but the prompt queued for it never sent. No composer is holding the text.`
      : "The workspace is ready, but the prompt queued for it never sent. No composer is holding the text.",
    cause: input.cause,
    details: {
      kind: "navigate",
      label: "Show",
      onNavigate: () => {
        // Selection alone is invisible from /workflows, /workspaces or
        // /settings, where the workspace host is hidden or inert, so this
        // routes first exactly as the pending-attempt notice does.
        navigateApp("/");
        input.showWorkspace();
      },
    },
  });
}
