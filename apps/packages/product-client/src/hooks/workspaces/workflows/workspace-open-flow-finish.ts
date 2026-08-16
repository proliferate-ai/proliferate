import {
  abandonRendererFlow,
  deferWorkspaceOpenContentStable,
  finishRendererFlow,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";

/**
 * Resolves the terminal outcome of a `workspace_open` renderer flow at the end
 * of bootstrapWorkspace (UX-latency R14). Exactly one of three things happens:
 *
 *  - abandonReason set          -> abandon (stale / error): no content_stable.
 *  - deferContentStableSessionId -> HAND OFF: transcript hydration moved off the
 *    critical path, so the pane finishes the flow when the selected session's
 *    transcript commits. Emitting content_stable here would lie — never emit a
 *    stable mark before the user can see the transcript.
 *  - neither                    -> finish now (empty workspace: nothing to wait
 *    for, the shell's empty state IS the stable content).
 */
export function finishWorkspaceOpenRendererFlow(input: {
  workspaceId: string;
  abandonReason: string | null;
  deferContentStableSessionId: string | null;
}): void {
  if (input.abandonReason !== null) {
    abandonRendererFlow({
      kind: "workspace_open",
      correlationKey: input.workspaceId,
      reason: input.abandonReason,
    });
    return;
  }
  if (input.deferContentStableSessionId !== null) {
    deferWorkspaceOpenContentStable({
      sessionId: input.deferContentStableSessionId,
      correlationKey: input.workspaceId,
    });
    return;
  }
  finishRendererFlow({ kind: "workspace_open", correlationKey: input.workspaceId });
}
