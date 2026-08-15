import { buildPendingWorkspaceUiKey } from "#product/lib/domain/workspaces/creation/pending-entry";
import type { ChatLaunchIntent } from "#product/lib/domain/chat/launch/launch-intent";

/**
 * Launch-intent shell ownership, kept apart from the intent view model.
 *
 * The launch-intent registry needs only these two answers, and it is reached
 * from the signed-out shell's eager graph (the chat launch-intent store hangs
 * off session creation). Everything else about an intent — retry modes, the
 * rendered view model, the catalog snapshot — is transcript-time work no login
 * screen can use, so it stays in `launch-intent.ts` and out of the login
 * first-load chunk, which has a fail-closed JS budget (PRO-230).
 *
 * `launch-intent.ts` re-exports both, so existing importers are unaffected.
 */

/** The workspace UI identities a launch intent is allowed to own the surface of. */
export interface LaunchIntentScope {
  pendingUiKey: string | null;
  workspaceId: string | null;
}

/**
 * An intent only owns the launch-intent pane / shell for its own workspace.
 * Before anything materializes, that scope is the pending-workspace UI key of
 * its own attempt; once a workspace is targeted or materialized, it is that
 * workspace's id. A `null` scope in both fields means the intent has not
 * attached to any workspace yet (the Home first-paint window).
 */
export function resolveLaunchIntentScope(intent: ChatLaunchIntent): LaunchIntentScope {
  return {
    pendingUiKey: intent.attemptId
      ? buildPendingWorkspaceUiKey({ attemptId: intent.attemptId })
      : null,
    workspaceId: intent.materializedWorkspaceId ?? intent.targetWorkspaceId,
  };
}

/**
 * Whether a launch intent with the given scope may own the surface of the
 * shell identified by `shellLogicalWorkspaceId`/`shellWorkspaceId`.
 *
 * A scoped intent (it has created a pending-workspace attempt, targets an
 * existing workspace, or has materialized one) may only own the matching
 * shell — this is what stops one workspace's launch intent from hijacking an
 * unrelated workspace's transcript (PRO-230). An unscoped intent (nothing
 * known yet — the Home first-paint window before anything materializes) may
 * only own a shell that itself has no workspace selected.
 */
export function launchIntentOwnsShell(args: {
  scope: LaunchIntentScope | null;
  shellLogicalWorkspaceId: string | null;
  shellWorkspaceId: string | null;
}): boolean {
  const pendingUiKey = args.scope?.pendingUiKey ?? null;
  const workspaceId = args.scope?.workspaceId ?? null;

  if (pendingUiKey === null && workspaceId === null) {
    return args.shellLogicalWorkspaceId === null && args.shellWorkspaceId === null;
  }

  return Boolean(
    (pendingUiKey !== null && args.shellLogicalWorkspaceId === pendingUiKey)
    || (workspaceId !== null && (
      args.shellWorkspaceId === workspaceId
      || args.shellLogicalWorkspaceId === workspaceId
    )),
  );
}
