import { useCallback, useMemo, useReducer } from "react";
import { useStartAgentLoginMutation } from "@anyharness/sdk-react";
import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";
import { AGENT_SETUP_COPY } from "@/copy/agents/agents-copy";
import {
  agentNeedsInstall,
  agentSupportsCredentials,
  isReadyAgent,
} from "@/lib/domain/agents/status";
import {
  formatAgentEnvVarLabel,
  getAgentSetupSubtitle,
  type AgentReconcileState,
} from "@/lib/domain/agents/status-presentation";
import { restartHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { useAgentCredentialsStore } from "@/stores/agents/agent-credentials-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useAgentInstallationActions } from "./use-agent-installation-actions";
import { useLocalAgentCredentials } from "./use-local-agent-credentials";
import {
  agentSetupWorkflowReducer,
  createInitialAgentSetupWorkflowState,
} from "./agent-setup-workflow-reducer";

interface UseAgentSetupWorkflowArgs {
  agent: AgentSummary;
  onClose: () => void;
  reconcileState?: AgentReconcileState;
  reconcileResult?: ReconcileAgentResult;
}

interface AgentCredentialFieldState {
  name: string;
  label: string;
  value: string;
  isConfigured: boolean;
  isEditing: boolean;
  isSaving: boolean;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAgentSetupWorkflow({
  agent,
  onClose,
  reconcileState = "idle",
  reconcileResult,
}: UseAgentSetupWorkflowArgs) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const restartRequired = useAgentCredentialsStore((state) => state.restartRequired);
  const clearRestartRequired = useAgentCredentialsStore((state) => state.clearRestartRequired);
  const loginMutation = useStartAgentLoginMutation();
  const {
    installAgent,
    isAgentSeedHydrating,
    refreshAgentResources,
  } = useAgentInstallationActions();
  const {
    configuredEnvVarNames,
    saveCredential,
  } = useLocalAgentCredentials();
  const [state, dispatch] = useReducer(
    agentSetupWorkflowReducer,
    undefined,
    createInitialAgentSetupWorkflowState,
  );

  const needsInstall = agentNeedsInstall(agent);
  const isReady = isReadyAgent(agent);
  const isUnsupported = agent.readiness === "unsupported";
  const showCredentials = agentSupportsCredentials(agent);
  const hasEnvVars = agent.expectedEnvVars.length > 0;
  const reconcileTriedInstall =
    reconcileResult?.outcome === "failed"
    || reconcileResult?.outcome === "installed";
  const isRetry = needsInstall && reconcileTriedInstall;
  const hasNewlySavedKeys = state.savedKeys.size > 0;
  const shouldRestartRuntime = restartRequired || hasNewlySavedKeys;

  const configuredEnvVarSet = useMemo(
    () => new Set(configuredEnvVarNames),
    [configuredEnvVarNames],
  );

  const credentialFields = useMemo<AgentCredentialFieldState[]>(
    () =>
      agent.expectedEnvVars.map((envVar: string) => ({
        name: envVar,
        label: formatAgentEnvVarLabel(envVar),
        value: state.envInputs[envVar] ?? "",
        isConfigured:
          configuredEnvVarSet.has(envVar) || state.savedKeys.has(envVar),
        isEditing: envVar in state.envInputs,
        isSaving: state.pendingAction === `save:${envVar}`,
      })),
    [agent.expectedEnvVars, configuredEnvVarSet, state.envInputs, state.pendingAction, state.savedKeys],
  );

  const installButtonLabel =
    isAgentSeedHydrating
      ? AGENT_SETUP_COPY.seedHydrating
      : reconcileState === "reconciling"
        ? AGENT_SETUP_COPY.installing
        : isRetry
          ? AGENT_SETUP_COPY.retryInstall
          : AGENT_SETUP_COPY.install;

  const loginButtonLabel = state.loginCommand
    ? AGENT_SETUP_COPY.refreshLoginAction
    : AGENT_SETUP_COPY.loginAction;

  const subtitle = getAgentSetupSubtitle(agent, reconcileResult);
  const isInstallBusy = state.pendingAction === "install";
  const isLoginBusy = state.pendingAction === "login";
  const isApplyBusy = state.pendingAction === "restart";
  const isBusy = state.pendingAction !== null;

  const startEditingCredential = useCallback((name: string) => {
    dispatch({ type: "credential_edit_started", name });
  }, []);

  const updateCredentialValue = useCallback((name: string, value: string) => {
    dispatch({ type: "credential_input_updated", name, value });
  }, []);

  const handleInstall = useCallback(async () => {
    dispatch({ type: "install_started" });

    try {
      await installAgent(agent.kind);
    } catch (error) {
      dispatch({ type: "install_failed", error: toErrorMessage(error) });
    } finally {
      dispatch({ type: "install_finished" });
    }
  }, [agent.kind, installAgent]);

  const handleLogin = useCallback(async () => {
    dispatch({ type: "login_started" });

    try {
      if (connectionState !== "healthy" || runtimeUrl.trim().length === 0) {
        throw new Error("AnyHarness runtime is not available.");
      }

      const login = await loginMutation.mutateAsync(agent.kind);
      dispatch({
        type: "login_succeeded",
        command: [login.command.program, ...login.command.args].join(" "),
        message: login.message ?? null,
      });
    } catch (error) {
      dispatch({ type: "login_failed", error: toErrorMessage(error) });
    } finally {
      dispatch({ type: "login_finished" });
    }
  }, [agent.kind, connectionState, loginMutation, runtimeUrl]);

  const handleSaveCredential = useCallback(async (name: string) => {
    const value = state.envInputs[name];
    if (!value?.trim()) {
      return;
    }

    dispatch({ type: "credential_save_started", name });

    try {
      await saveCredential(name, value.trim());
      dispatch({ type: "credential_saved", name });
    } catch (error) {
      dispatch({ type: "credential_save_failed", error: toErrorMessage(error) });
    } finally {
      dispatch({ type: "credential_save_finished" });
    }
  }, [saveCredential, state.envInputs]);

  const handleApplyAndClose = useCallback(async () => {
    dispatch({ type: "restart_started" });

    try {
      await restartHarnessRuntime();
      await refreshAgentResources();
      clearRestartRequired();
      onClose();
    } catch (error) {
      dispatch({ type: "restart_failed", error: toErrorMessage(error) });
    } finally {
      dispatch({ type: "restart_finished" });
    }
  }, [clearRestartRequired, onClose, refreshAgentResources]);

  return {
    subtitle,
    needsInstall,
    isReady,
    isUnsupported,
    showCredentials,
    hasEnvVars,
    hasNewlySavedKeys,
    shouldRestartRuntime,
    isRetry,
    isAgentSeedHydrating,
    isInstallBusy,
    isLoginBusy,
    isApplyBusy,
    isBusy,
    installButtonLabel,
    loginButtonLabel,
    installError: state.installError,
    credentialsError: state.credentialsError,
    loginError: state.loginError,
    applyError: state.applyError,
    loginCommand: state.loginCommand,
    loginMessage: state.loginMessage,
    credentialFields,
    handleInstall,
    handleLogin,
    handleSaveCredential,
    handleApplyAndClose,
    startEditingCredential,
    updateCredentialValue,
  };
}
