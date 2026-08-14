import type {
  SupportSnapshotConsentV1,
  SupportSnapshotSelectionV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  ResolvedSupportSnapshotAccess,
  SupportActiveSessionCandidate,
  SupportWorkspaceCandidate,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import { isSupportIdentity } from "#product/lib/domain/support/support-session-contract";

/**
 * The frozen snapshot disclosure. Both hosted Desktop modals show exactly this
 * label and helper, and the helper stays visible while the box is unchecked so
 * the user reads what a snapshot may contain before deciding. The strings are
 * verbatim from the support system document and are not paraphrased here.
 */
export const SUPPORT_SNAPSHOT_CONSENT_LABEL = "Include a diagnostic snapshot";

export const SUPPORT_SNAPSHOT_CONSENT_HELPER =
  "May include the selected session's prompts, transcript, tool and terminal "
  + "output, file paths, and provider errors. Detected secrets are removed "
  + "before upload.";

/** The disclosure the consent epoch is bound to; native revalidates it. */
export const SUPPORT_SNAPSHOT_DISCLOSURE_VERSION =
  "desktop_support_snapshot_customer_content_v1";

export type SupportSnapshotScopeChoice = SupportSnapshotSelectionV1["kind"];

export const SUPPORT_SNAPSHOT_SCOPE_LABELS: Record<SupportSnapshotScopeChoice, string> = {
  active_session: "Current session",
  recent_activity: "Recent activity (15 minutes)",
};

export interface SupportSnapshotBindingCandidates {
  selectedWorkspace: SupportWorkspaceCandidate | null;
  activeSession: SupportActiveSessionCandidate | null;
}

/**
 * Whether **Current session** may be offered at all. This is a pure read of
 * already-resident selection/directory state: it maps the active UI session
 * through the session directory to an exact materialized session in the
 * selected bundled-local workspace and touches no customer detail, no native
 * command, and no runtime request. Native still revalidates the binding before
 * any staging.
 */
export function activeSessionScopeAvailable(
  candidates: SupportSnapshotBindingCandidates,
): boolean {
  const workspace = candidates.selectedWorkspace;
  const session = candidates.activeSession;
  return workspace?.kind === "bundled_local"
    && isSupportIdentity(workspace.workspaceId)
    && isSupportIdentity(workspace.anyharnessWorkspaceId)
    && !!session
    && isSupportIdentity(session.uiSessionId)
    && session.directoryWorkspaceId === workspace.workspaceId
    && isSupportIdentity(session.materializedSessionId);
}

/**
 * **Recent activity** is always available and is the default whenever the
 * exact active-session mapping is unavailable.
 */
export function defaultSupportSnapshotScope(
  candidates: SupportSnapshotBindingCandidates,
): SupportSnapshotScopeChoice {
  return activeSessionScopeAvailable(candidates) ? "active_session" : "recent_activity";
}

/**
 * A stable key for the exact workspace/session binding the consent epoch is
 * granted against. Any change supersedes the epoch.
 */
export function supportSnapshotBindingKey(
  candidates: SupportSnapshotBindingCandidates,
): string {
  const workspace = candidates.selectedWorkspace;
  const session = candidates.activeSession;
  return JSON.stringify([
    workspace ? [workspace.kind, workspace.workspaceId] : null,
    session ? [session.uiSessionId, session.directoryWorkspaceId, session.materializedSessionId] : null,
  ]);
}

/**
 * The exact selection the consent epoch names, or null when the chosen scope
 * cannot be bound. `resolveSupportSnapshotAccess` only answers `none` for
 * recent activity, which is the disclosed no-workspace collection.
 */
export function supportSnapshotSelection(
  access: ResolvedSupportSnapshotAccess,
): SupportSnapshotSelectionV1 | null {
  if (access.state === "resolved") {
    return access.selection;
  }
  if (access.state === "none") {
    return { kind: "recent_activity", workspace: access.binding };
  }
  return null;
}

export function supportSnapshotConsent(input: {
  grantedAt: string;
  selection: SupportSnapshotSelectionV1;
}): SupportSnapshotConsentV1 {
  return {
    version: 1,
    disclosureVersion: SUPPORT_SNAPSHOT_DISCLOSURE_VERSION,
    grantedAt: input.grantedAt,
    selection: input.selection,
  };
}
