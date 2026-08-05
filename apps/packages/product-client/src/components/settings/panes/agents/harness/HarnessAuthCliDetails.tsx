import { Button } from "#product/primitives/Button";
import { AgentLoginTerminalPanel } from "#product/components/agents/AgentLoginTerminalPanel";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { isReadyAgent } from "#product/lib/domain/agents/status";

/**
 * CLI method detail (design-handoff v2): when the CLI is authenticated there is
 * NOTHING here — the header badge already says so, and the state must be said
 * exactly once. When it isn't, a single primary "Authenticate" button opens the
 * inline login terminal in-page (login_terminal.rs over
 * loginWorkflow.openAuthTerminal — the flow itself is unchanged).
 *
 * Both surfaces share this component: the login-terminal workflow resolves a
 * surface-aware runtime connection (local desktop runtime vs. the Cloud
 * sandbox), so nothing here branches on surface.
 */
export function CliDetails({ editor }: { editor: HarnessAuthEditorApi }) {
  const { localAgent, loginSession, loginWorkflow } = editor;

  // Prefer cliAuthState for CLI status (env-unmasked); fall back to readiness
  // for older runtimes that don't yet expose it.
  const cliAuthState = localAgent?.cliAuthState;
  const isAuthenticated = cliAuthState
    ? cliAuthState === "authenticated"
    : localAgent != null && isReadyAgent(localAgent);

  const canRunLogin = cliAuthState
    ? (cliAuthState === "expired" || cliAuthState === "absent")
      && localAgent?.supportsLogin
    : localAgent != null
      && !isReadyAgent(localAgent)
      && localAgent.readiness === "login_required"
      && localAgent.supportsLogin;

  // Login is offerable only when the agent both supports it AND the CLI's own
  // state says it can be run right now — `??` binds tighter than `&&`, so the
  // naive `localAgent?.supportsLogin ?? canRunLogin` silently ignored
  // canRunLogin whenever supportsLogin was defined (even `false`).
  const canOfferLogin = (localAgent?.supportsLogin ?? false) && Boolean(canRunLogin);

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
