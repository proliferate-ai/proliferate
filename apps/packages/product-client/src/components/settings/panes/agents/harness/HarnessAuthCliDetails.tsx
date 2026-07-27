import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { AgentLoginTerminalPanel } from "#product/components/agents/AgentLoginTerminalPanel";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { useAgentResourcesCache } from "#product/hooks/access/anyharness/agents/use-agent-resources-cache";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { isReadyAgent } from "#product/lib/domain/agents/status";
import { HarnessStatusRow } from "#product/components/settings/panes/agents/harness/HarnessStatusRow";

// Both surfaces now share this component unmodified: the login-terminal
// workflow (editor.loginWorkflow) already resolves a surface-aware runtime
// connection (local desktop runtime vs. the one Cloud sandbox), so nothing
// here branches on surface anymore.
export function CliDetails({ editor }: { editor: HarnessAuthEditorApi }) {
  const { localAgent, loginSession, loginWorkflow } = editor;
  // Surface-aware: on cloud this is the sandbox gateway's runtime URL
  // (CloudAnyHarnessRuntimeProvider), on local it's the desktop's own runtime —
  // both come from the same AnyHarness runtime context the login workflow reads.
  const runtimeUrl = loginWorkflow.runtimeConnection.baseUrl;
  const { invalidateAgentListResources } = useAgentResourcesCache();
  const [refreshing, setRefreshing] = useState(false);
  // §3: the native status row is clickable, and opens the choice between
  // refreshing the status and running a login terminal session. The
  // login-terminal flow itself is unchanged (login_terminal.rs over
  // loginWorkflow.openAuthTerminal) — this ruling only moved its entry point
  // onto the row that explains why it is needed.
  const [choiceOpen, setChoiceOpen] = useState(false);

  function handleRefreshCredential() {
    if (!runtimeUrl.trim()) return;
    setRefreshing(true);
    void invalidateAgentListResources(runtimeUrl).finally(() => {
      setRefreshing(false);
    });
  }

  // Prefer cliAuthState for CLI status (env-unmasked); fall back to readiness
  // for older runtimes that don't yet expose it.
  const cliAuthState = localAgent?.cliAuthState;
  const cliIsAuthenticated = cliAuthState === "authenticated";
  const cliIsExpired = cliAuthState === "expired";
  const cliIsAbsent = cliAuthState === "absent";

  // Fallback: when cliAuthState is missing/unsupported, derive from readiness
  const fallbackCanRunLogin =
    localAgent != null
    && !isReadyAgent(localAgent)
    && localAgent.readiness === "login_required"
    && localAgent.supportsLogin;
  const fallbackIsAuthenticated = localAgent != null && isReadyAgent(localAgent);

  // If cliAuthState is present, use it; otherwise fall back to readiness-based logic
  const canRunLogin = cliAuthState
    ? (cliIsExpired || cliIsAbsent) && localAgent?.supportsLogin
    : fallbackCanRunLogin;

  const isAuthenticated = cliAuthState
    ? cliIsAuthenticated
    : fallbackIsAuthenticated;

  const showLoginTerminal =
    loginSession != null
    && (loginSession.isStarting
      || loginSession.terminal !== null
      || loginSession.errorMessage !== null);

  const failing = cliIsExpired || cliIsAbsent || (canRunLogin && !cliAuthState);
  const label = cliIsExpired
    ? HARNESS_PANE_COPY.cliExpired
    : failing
      ? HARNESS_PANE_COPY.cliNotAuthenticated
      : isAuthenticated
        ? HARNESS_PANE_COPY.cliAuthenticated
        : HARNESS_PANE_COPY.cliUnknown;

  // Login is offerable only when the agent both supports it AND the CLI's own
  // state says it can be run right now — `??` binds tighter than `&&`, so the
  // naive `localAgent?.supportsLogin ?? canRunLogin` silently ignored
  // canRunLogin whenever supportsLogin was defined (even `false`).
  const canOfferLogin = (localAgent?.supportsLogin ?? false) && canRunLogin;

  const loginButton = (
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
        setChoiceOpen(false);
      }}
    >
      {loginSession?.isStarting
        ? HARNESS_PANE_COPY.runLoginOpening
        : HARNESS_PANE_COPY.runLogin}
    </Button>
  );

  return (
    <HarnessStatusRow
      data-harness-status="native"
      label={label}
      tone={failing ? "destructive" : isAuthenticated ? "success" : "neutral"}
      // Saved and live state coexist (§3): the native row's saved fact is that
      // no injected source is configured, so the CLI's own session is what a
      // launch will use — it stays visible next to the live observation instead
      // of being replaced by it.
      savedState={editor.native ? HARNESS_PANE_COPY.nativeStateLocal : null}
      description={HARNESS_PANE_COPY.nativeRowHint}
      refreshLabel="Refresh credential status"
      refreshing={refreshing}
      onRefresh={handleRefreshCredential}
      onClick={() => setChoiceOpen((open) => !open)}
      expanded={choiceOpen}
    >
      {choiceOpen ? (
        <div className="flex flex-wrap gap-2 pb-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              handleRefreshCredential();
              setChoiceOpen(false);
            }}
          >
            {HARNESS_PANE_COPY.nativeRefreshChoice}
          </Button>
          {canOfferLogin ? loginButton : null}
        </div>
      ) : null}

      {/* The direct login affordance stays outside the choice group whenever the
          CLI actually needs a login, so the fix is one click from a failing row
          (and so the qualification flow's "Authenticate" button is always
          reachable). */}
      {canOfferLogin && !choiceOpen ? (
        <div className="pb-3">
          {loginButton}
        </div>
      ) : null}

      {showLoginTerminal && loginSession ? (
        <div className="pb-3">
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
        </div>
      ) : null}
    </HarnessStatusRow>
  );
}
