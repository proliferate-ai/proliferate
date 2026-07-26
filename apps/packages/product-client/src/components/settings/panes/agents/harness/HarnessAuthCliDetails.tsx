import { useState } from "react";
import { RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { AgentLoginTerminalPanel } from "#product/components/agents/AgentLoginTerminalPanel";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { useAgentResourcesCache } from "#product/hooks/access/anyharness/agents/use-agent-resources-cache";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { isReadyAgent } from "#product/lib/domain/agents/status";
import { HarnessPanelBlock, type HarnessBlockVariant } from "#product/components/settings/panes/agents/harness/HarnessPanelBlock";

// Both surfaces now share this component unmodified: the login-terminal
// workflow (editor.loginWorkflow) already resolves a surface-aware runtime
// connection (local desktop runtime vs. the one Cloud sandbox), so nothing
// here branches on surface anymore.
export function CliDetails({
  editor,
  variant,
}: {
  editor: HarnessAuthEditorApi;
  variant: HarnessBlockVariant;
}) {
  const { localAgent, loginSession, loginWorkflow } = editor;
  // Surface-aware: on cloud this is the sandbox gateway's runtime URL
  // (CloudAnyHarnessRuntimeProvider), on local it's the desktop's own runtime —
  // both come from the same AnyHarness runtime context the login workflow reads.
  const runtimeUrl = loginWorkflow.runtimeConnection.baseUrl;
  const { invalidateAgentListResources } = useAgentResourcesCache();
  const [refreshing, setRefreshing] = useState(false);

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

  return (
    <HarnessPanelBlock variant={variant} title={HARNESS_PANE_COPY.detailsCli}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          {cliIsExpired ? (
            <p className="text-ui font-medium text-destructive">
              CLI credentials expired
            </p>
          ) : cliIsAbsent || (canRunLogin && !cliAuthState) ? (
            <p className="text-ui font-medium text-destructive">
              {HARNESS_PANE_COPY.cliNotAuthenticated}
            </p>
          ) : isAuthenticated ? (
            <p className="text-ui-sm text-muted-foreground">
              {HARNESS_PANE_COPY.cliAuthenticated}
            </p>
          ) : (
            <p className="text-ui-sm text-muted-foreground">
              {HARNESS_PANE_COPY.nativeStateLocal}
            </p>
          )}
          <IconButton
            aria-label="Refresh credential status"
            title="Refresh credential status"
            disabled={refreshing}
            onClick={handleRefreshCredential}
          >
            <RefreshCw className={`icon-paired ${refreshing ? "animate-spin" : ""}`} />
          </IconButton>
        </div>

        {canRunLogin ? (
          <div>
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
          </div>
        ) : null}

        {showLoginTerminal && loginSession ? (
          <AgentLoginTerminalPanel
            session={loginSession}
            baseUrl={loginWorkflow.runtimeConnection.baseUrl}
            authToken={loginWorkflow.runtimeConnection.authToken}
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
    </HarnessPanelBlock>
  );
}
