import {
  AnyHarnessError,
  type AgentLoginTerminalRecord,
  type AgentSummary,
} from "@anyharness/sdk";
import {
  useAnyHarnessRuntimeContext,
  useCloseAgentLoginTerminalMutation,
  useStartAgentLoginTerminalMutation,
} from "@anyharness/sdk-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentResourcesCache } from "@/hooks/access/anyharness/agents/use-agent-resources-cache";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export interface AgentAuthTerminalSession {
  kind: string;
  terminal: AgentLoginTerminalRecord | null;
  message: string | null;
  errorMessage: string | null;
  isStarting: boolean;
  focusRequestToken: number;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof AnyHarnessError) {
    if (error.problem.status === 404) {
      return "The current AnyHarness runtime does not expose in-product auth terminals yet. Restart Proliferate so the bundled runtime picks up the latest auth support.";
    }
    return error.problem.detail ?? error.problem.title;
  }
  return error instanceof Error ? error.message : String(error);
}

export function useAgentAuthTerminalWorkflow() {
  // Owns Agent Defaults' local auth terminal workflow. Components decide layout;
  // this hook owns start/close/restart and post-exit readiness refresh.
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const { invalidateAgentLaunchReadinessResources } = useAgentResourcesCache();
  const startLoginTerminal = useStartAgentLoginTerminalMutation();
  const closeLoginTerminal = useCloseAgentLoginTerminalMutation();
  const [sessionsByKind, setSessionsByKind] = useState<Record<string, AgentAuthTerminalSession>>({});

  const runtimeConnection = useMemo(() => ({
    baseUrl: runtime.runtimeUrl?.trim() || runtimeUrl.trim(),
    authToken: runtime.authToken ?? undefined,
  }), [runtime.authToken, runtime.runtimeUrl, runtimeUrl]);
  const activeSessionCount = useMemo(
    () => Object.values(sessionsByKind).filter((session) =>
      session.isStarting || session.terminal
    ).length,
    [sessionsByKind],
  );

  const refreshAgentReadiness = useCallback(async () => {
    await invalidateAgentLaunchReadinessResources(runtimeConnection.baseUrl);
  }, [invalidateAgentLaunchReadinessResources, runtimeConnection.baseUrl]);

  const closeExistingTerminal = useCallback(async (
    session: AgentAuthTerminalSession | undefined,
  ) => {
    const terminalId = session?.terminal?.id;
    if (!terminalId) {
      return;
    }
    try {
      await closeLoginTerminal.mutateAsync(terminalId);
    } catch {
      // Closing is best effort; the runtime will reap exited PTYs.
    }
  }, [closeLoginTerminal]);

  const openAuthTerminal = useCallback(async (
    agent: AgentSummary,
    options?: { restart?: boolean },
  ) => {
    if (connectionState !== "healthy" || runtimeConnection.baseUrl.trim().length === 0) {
      setSessionsByKind((current) => ({
        ...current,
        [agent.kind]: {
          kind: agent.kind,
          terminal: current[agent.kind]?.terminal ?? null,
          message: current[agent.kind]?.message ?? null,
          errorMessage: "AnyHarness runtime is not available.",
          isStarting: false,
          focusRequestToken: (current[agent.kind]?.focusRequestToken ?? 0) + 1,
        },
      }));
      return;
    }

    const existingSession = sessionsByKind[agent.kind];
    if (existingSession?.terminal && !options?.restart) {
      setSessionsByKind((current) => ({
        ...current,
        [agent.kind]: {
          ...existingSession,
          focusRequestToken: existingSession.focusRequestToken + 1,
        },
      }));
      return;
    }

    await closeExistingTerminal(existingSession);

    setSessionsByKind((current) => ({
      ...current,
      [agent.kind]: {
        kind: agent.kind,
        terminal: null,
        message: null,
        errorMessage: null,
        isStarting: true,
        focusRequestToken: (current[agent.kind]?.focusRequestToken ?? 0) + 1,
      },
    }));

    try {
      const response = await startLoginTerminal.mutateAsync(agent.kind);
      setSessionsByKind((current) => ({
        ...current,
        [agent.kind]: {
          kind: agent.kind,
          terminal: response.agentLoginTerminal,
          message: response.message ?? null,
          errorMessage: null,
          isStarting: false,
          focusRequestToken: (current[agent.kind]?.focusRequestToken ?? 0) + 1,
        },
      }));
    } catch (error) {
      setSessionsByKind((current) => ({
        ...current,
        [agent.kind]: {
          kind: agent.kind,
          terminal: null,
          message: null,
          errorMessage: toErrorMessage(error),
          isStarting: false,
          focusRequestToken: (current[agent.kind]?.focusRequestToken ?? 0) + 1,
        },
      }));
    }
  }, [
    closeExistingTerminal,
    connectionState,
    runtimeConnection.baseUrl,
    sessionsByKind,
    startLoginTerminal,
  ]);

  const closeAuthTerminal = useCallback(async (kind: string) => {
    const session = sessionsByKind[kind];
    setSessionsByKind((current) => {
      const next = { ...current };
      delete next[kind];
      return next;
    });
    await closeExistingTerminal(session);
    await refreshAgentReadiness();
  }, [closeExistingTerminal, refreshAgentReadiness, sessionsByKind]);

  const handleTerminalExit = useCallback(async (
    kind: string,
    code: number | null,
  ) => {
    setSessionsByKind((current) => {
      const session = current[kind];
      if (!session?.terminal) {
        return current;
      }
      return {
        ...current,
        [kind]: {
          ...session,
          terminal: {
            ...session.terminal,
            status: "exited",
            exitCode: code,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
    await refreshAgentReadiness();
  }, [refreshAgentReadiness]);

  useEffect(() => {
    if (
      activeSessionCount === 0
      || connectionState !== "healthy"
      || runtimeConnection.baseUrl.trim().length === 0
    ) {
      return;
    }

    const tick = () => {
      void refreshAgentReadiness();
    };
    const firstRefresh = window.setTimeout(tick, 1000);
    const interval = window.setInterval(tick, 2500);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(interval);
    };
  }, [
    activeSessionCount,
    connectionState,
    refreshAgentReadiness,
    runtimeConnection.baseUrl,
  ]);

  return {
    closeAuthTerminal,
    handleTerminalExit,
    openAuthTerminal,
    refreshAgentReadiness,
    runtimeConnection,
    sessionsByKind,
  };
}
