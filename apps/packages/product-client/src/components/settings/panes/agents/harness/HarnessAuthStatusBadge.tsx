import { RefreshCw } from "#product/primitives/icons/platform";
import { Badge, type BadgeTone } from "#product/primitives/Badge";
import { IconButton } from "#product/primitives/IconButton";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { isReadyAgent } from "#product/lib/domain/agents/status";
import { isRowComplete } from "#product/lib/domain/settings/harness-auth-sources";
import type { AuthMethod } from "#product/components/settings/panes/agents/harness/HarnessAuthSection";

export interface HarnessAuthStatus {
  label: string;
  tone: BadgeTone;
}

/**
 * The ONE authentication state of the pane (design-handoff v2: "the state must
 * be said exactly once"), recomputed from the selected method:
 * - api_key → Authenticated iff a complete row is enabled
 * - cli     → the runtime's cliAuthState (readiness fallback for old runtimes)
 * - gateway → the enrollment/capabilities state
 */
export function deriveAuthStatus(
  method: AuthMethod,
  editor: HarnessAuthEditorApi,
): HarnessAuthStatus {
  if (method === "gateway") {
    const capabilities = editor.capabilitiesQuery.data;
    const enrollment = editor.enrollmentQuery.data;
    const isLoading =
      editor.capabilitiesQuery.isPending || editor.enrollmentQuery.isPending;
    if (isLoading) {
      return { label: HARNESS_PANE_COPY.runtimeChecking, tone: "neutral" };
    }
    const failed =
      enrollment?.syncStatus === "failed" || capabilities?.gatewayEnabled === false;
    if (failed) {
      return { label: HARNESS_PANE_COPY.authBadgeEnrollmentFailed, tone: "destructive" };
    }
    const synced =
      Boolean(capabilities?.gatewayEnabled)
      && (enrollment === undefined || enrollment.syncStatus === "synced");
    return synced
      ? { label: HARNESS_PANE_COPY.authBadgeAuthenticated, tone: "success" }
      : { label: HARNESS_PANE_COPY.gatewayPending, tone: "warning" };
  }

  if (method === "seat") {
    // Founder ruling 2026-08-27 (PR #2254's acceptance false green): the seat
    // method may NEVER borrow the CLI arm's native-login state — that arm
    // reads bare file/keychain presence of the machine's own login, which is
    // a different credential. A seat's badge reads only the runtime's derived
    // evidence state (`authState`): the seat tier-1 trial's 401 lands there
    // as `expired` (the seat STAYS SAVED; only the badge goes red), a green
    // trial or probe observation lands as `authenticated`/`usable`, and
    // anything short of evidence is the spec's own word — "unverified".
    if (!editor.editorState.seatEnabled) {
      return { label: HARNESS_PANE_COPY.authBadgeNotConfigured, tone: "neutral" };
    }
    const display = editor.localAgent?.authState?.display;
    if (display === "expired") {
      return { label: HARNESS_PANE_COPY.authBadgeExpired, tone: "destructive" };
    }
    if (display === "usable" || display === "authenticated") {
      return { label: HARNESS_PANE_COPY.authBadgeAuthenticated, tone: "success" };
    }
    return { label: HARNESS_PANE_COPY.authBadgeUnverified, tone: "warning" };
  }

  if (method === "api_key") {
    const enabled = editor.editorState.rows.some(
      (row) => row.enabled && isRowComplete(row),
    );
    return enabled
      ? { label: HARNESS_PANE_COPY.authBadgeAuthenticated, tone: "success" }
      : { label: HARNESS_PANE_COPY.authBadgeNotConfigured, tone: "neutral" };
  }

  // cli
  const localAgent = editor.localAgent;
  const cliAuthState = localAgent?.cliAuthState;
  const authenticated = cliAuthState
    ? cliAuthState === "authenticated"
    : localAgent != null && isReadyAgent(localAgent);
  if (authenticated) {
    return { label: HARNESS_PANE_COPY.authBadgeAuthenticated, tone: "success" };
  }
  if (cliAuthState === "expired") {
    return { label: HARNESS_PANE_COPY.cliExpired, tone: "warning" };
  }
  return { label: HARNESS_PANE_COPY.authBadgeNotAuthenticated, tone: "warning" };
}

/** OpenCode's providers-only state: authenticated iff any provider key delivers. */
export function deriveProvidersStatus(): HarnessAuthStatus {
  // OpenCode's own CLI logins always apply, so the pane never claims "not
  // authenticated" — a bare pane is simply "authenticated by its own logins"
  // (design-handoff v2 §2: the badge always reads Authenticated).
  return { label: HARNESS_PANE_COPY.authBadgeAuthenticated, tone: "success" };
}

/**
 * The badge + 24px refresh cluster mounted in the section header's action
 * slot. The refresh icon spins while any of the state's queries refetch.
 */
export function HarnessAuthStatusAction({
  status,
  refreshing,
  onRefresh,
  "data-harness-status": dataHarnessStatus,
}: {
  status: HarnessAuthStatus;
  refreshing: boolean;
  onRefresh: () => void;
  "data-harness-status"?: string;
}) {
  return (
    <>
      <Badge tone={status.tone} data-harness-status={dataHarnessStatus}>
        <span
          aria-hidden
          className="icon-status mr-1.5 inline-block shrink-0 rounded-full bg-current"
        />
        {status.label}
      </Badge>
      <IconButton
        aria-label="Refresh status"
        title="Refresh status"
        disabled={refreshing}
        onClick={onRefresh}
      >
        <RefreshCw className={`icon-paired ${refreshing ? "animate-spin" : ""}`} />
      </IconButton>
    </>
  );
}
