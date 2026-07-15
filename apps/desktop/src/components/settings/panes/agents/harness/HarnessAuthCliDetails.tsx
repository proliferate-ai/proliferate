import { useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { AgentLoginTerminalPanel } from "@/components/agents/AgentLoginTerminalPanel";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useAgentResourcesCache } from "@/hooks/access/anyharness/agents/use-agent-resources-cache";
import type { HarnessAuthEditorApi } from "@/hooks/agents/workflows/use-harness-auth-editor";
import { isReadyAgent } from "@/lib/domain/agents/status";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { HarnessPanelBlock, type HarnessBlockVariant } from "./HarnessPanelBlock";

export function CliDetails({
  surface,
  editor,
  variant,
}: {
  surface: AgentAuthSurface;
  editor: HarnessAuthEditorApi;
  variant: HarnessBlockVariant;
}) {
  const { localAgent, loginSession, loginWorkflow } = editor;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateAgentListResources } = useAgentResourcesCache();
  const [refreshing, setRefreshing] = useState(false);

  function handleRefreshCredential() {
    if (!runtimeUrl.trim()) return;
    setRefreshing(true);
    void invalidateAgentListResources(runtimeUrl).finally(() => {
      setRefreshing(false);
    });
  }

  if (surface === "cloud") {
    return (
      <HarnessPanelBlock variant={variant} title={HARNESS_PANE_COPY.detailsCli}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.nativeStateCloud}
        </p>
      </HarnessPanelBlock>
    );
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
            <p className="text-sm font-medium text-destructive">
              CLI credentials expired
            </p>
          ) : cliIsAbsent || (canRunLogin && !cliAuthState) ? (
            <p className="text-sm font-medium text-destructive">
              {HARNESS_PANE_COPY.cliNotAuthenticated}
            </p>
          ) : isAuthenticated ? (
            <p className="text-sm text-muted-foreground">
              {HARNESS_PANE_COPY.cliAuthenticated}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {HARNESS_PANE_COPY.nativeStateLocal}
            </p>
          )}
          <IconButton
            aria-label="Refresh credential status"
            title="Refresh credential status"
            disabled={refreshing}
            onClick={handleRefreshCredential}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </IconButton>
        </div>

        {canRunLogin ? (
          <div>
            <Button
              type="button"
              variant="secondary"
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
