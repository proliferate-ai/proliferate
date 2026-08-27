import { Button } from "#product/primitives/Button";
import { AgentLoginTerminalPanel } from "#product/components/agents/AgentLoginTerminalPanel";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { useHarnessStatus } from "#product/hooks/access/anyharness/agent-auth/use-harness-status";
import { isStatusGreen } from "#product/lib/domain/settings/agent-auth-status-presentation";

/**
 * CLI method detail (design-handoff v2): when the harness is authenticated there
 * is NOTHING here — the header badge already says so, and the state must be said
 * exactly once. When it isn't, a single primary "Authenticate" button opens the
 * inline login terminal in-page (login_terminal.rs over
 * loginWorkflow.openAuthTerminal — the flow itself is unchanged).
 *
 * The ONE fact that hides this area is the runtime's status document: a dated,
 * verified observation. Nothing here reads `cliAuthState` or `readiness` any
 * more — that surviving derivation could disagree with the badge and take the
 * user's last way out with it (a stale-authenticated keychain plus a failed or
 * absent document rendered a destructive "Not authenticated" badge AND no
 * Authenticate button: a dead end). An affordance is never gated on agreement
 * between two sources; it is offered whenever the document is not green.
 *
 * Founder-ruled 2026-08-27: native is a PERMANENT supported method. A harness
 * launching on its own detected login with a green probe is a healthy terminal
 * state — this area renders nothing for it (the header badge says "Using your
 * own login"), and nothing here nags toward a managed method. Authenticate and
 * the mint offer stay OFFERED affordances for the non-green states only.
 *
 * Both surfaces share this component: the login-terminal workflow resolves a
 * surface-aware runtime connection (local desktop runtime vs. the Cloud
 * sandbox), so nothing here branches on surface.
 */
export function CliDetails({
  harnessKind,
  editor,
}: {
  harnessKind: string;
  editor: HarnessAuthEditorApi;
}) {
  const { localAgent, loginSession, loginWorkflow } = editor;
  const status = useHarnessStatus(harnessKind);

  // Green is a DATED, verified observation (spec §4 cell 4: "green only with an
  // evidence age"). Anything else — failed, unverified, no document at all —
  // leaves the way forward on screen.
  const isAuthenticated = isStatusGreen(status);

  // Login is offerable when the harness supports it and the machine has not
  // said this harness is authenticated. `supportsLogin` is a capability of the
  // harness, not a state of its auth, so it is the one non-document input.
  const canOfferLogin = (localAgent?.supportsLogin ?? false) && !isAuthenticated;

  const showLoginTerminal =
    loginSession != null
    && (loginSession.isStarting
      || loginSession.terminal !== null
      || loginSession.errorMessage !== null);

  if (isAuthenticated && !showLoginTerminal) {
    return null;
  }

  return (
    <div className="space-y-3" data-harness-status="native">
      {canOfferLogin && !showLoginTerminal ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={loginSession?.isStarting ?? false}
          onClick={() => {
            if (localAgent) {
              void loginWorkflow.openAuthTerminal(localAgent, {
                restart: Boolean(loginSession),
              });
            }
          }}
        >
          {loginSession?.isStarting
            ? HARNESS_PANE_COPY.runLoginOpening
            : HARNESS_PANE_COPY.runLogin}
        </Button>
      ) : null}

      {showLoginTerminal && loginSession ? (
        <AgentLoginTerminalPanel
          session={loginSession}
          baseUrl={loginWorkflow.runtimeConnection.baseUrl}
          authToken={loginWorkflow.runtimeConnection.authToken}
          webSocketAuthTransport={loginWorkflow.runtimeConnection.webSocketAuthTransport}
          onClose={(kind) => {
            void loginWorkflow.closeAuthTerminal(kind);
          }}
          onExit={(kind, code) => {
            void loginWorkflow.handleTerminalExit(kind, code);
          }}
          onRestart={() => {
            if (localAgent) {
              void loginWorkflow.openAuthTerminal(localAgent, { restart: true });
            }
          }}
        />
      ) : null}
    </div>
  );
}
