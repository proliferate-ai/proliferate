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
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useAgentResourcesCache } from "#product/hooks/access/anyharness/agents/use-agent-resources-cache";
import { cloudSandboxGatewayRuntimeUrl } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

export interface AgentLoginTerminalSession {
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

export function useAgentLoginTerminalWorkflow(surface: AgentAuthSurface) {
  // Owns Agent Defaults' auth terminal workflow for BOTH surfaces. Components
  // decide layout; this hook owns start/close/restart and post-exit readiness
  // refresh. On the cloud surface the runtime connection is the user's one
  // managed-Cloud sandbox (mirrors CloudAnyHarnessRuntimeProvider's resolution),
  // never the local desktop runtime — a fresh gateway access token is minted
  // per terminal open, since WebSocket connections cannot ride the
  // fetch-wrapping bearer-refresh trick the REST/query hooks use.
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const host = useProductHost();
  const cloudClient = host.cloud.client;
  const isCloudSurface = surface === "cloud";
  const { invalidateAgentLaunchReadinessResources } = useAgentResourcesCache();
  const startLoginTerminal = useStartAgentLoginTerminalMutation();
  const closeLoginTerminal = useCloseAgentLoginTerminalMutation();
  const [sessionsByKind, setSessionsByKind] = useState<Record<string, AgentLoginTerminalSession>>({});
  // Minted lazily in openAuthTerminal (cloud only) — never falls back to a
  // stale value across sandboxes/users, since each open re-mints it.
  const [cloudAuthToken, setCloudAuthToken] = useState<string | undefined>(undefined);

  const cloudBaseUrl = isCloudSurface && cloudClient
    ? cloudSandboxGatewayRuntimeUrl(cloudClient)
    : "";

  const runtimeConnection = useMemo(() => ({
    baseUrl: isCloudSurface
      ? cloudBaseUrl
      : (runtime.runtimeUrl?.trim() || runtimeUrl.trim()),
    authToken: isCloudSurface ? cloudAuthToken : (runtime.authToken ?? undefined),
  }), [cloudAuthToken, cloudBaseUrl, isCloudSurface, runtime.authToken, runtime.runtimeUrl, runtimeUrl]);
  // Cloud has no local "connecting/failed" boot sequence to gate on — the
  // surface is already behind CloudGuard (cloudActive) by the time this runs,
  // so a resolved sandbox base URL is itself the readiness signal. Local keeps
  // gating on the desktop runtime's own connection lifecycle.
  const runtimeReady = isCloudSurface
    ? runtimeConnection.baseUrl.trim().length > 0
    : connectionState === "healthy" && runtimeConnection.baseUrl.trim().length > 0;
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
    session: AgentLoginTerminalSession | undefined,
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
    if (!runtimeReady) {
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
      // The WebSocket viewport (AgentLoginTerminalPanel) cannot ride the
      // context's fetch-wrapping bearer refresh, so a cloud open mints its own
      // token here — once per open, mirroring withFreshCloudSandboxGatewayAccessToken's
      // per-resolve minting for terminal-stream connections.
      if (isCloudSurface) {
        setCloudAuthToken(await host.cloud.getSandboxGatewayAccessToken());
      }
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
    host.cloud,
    isCloudSurface,
    runtimeReady,
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
    if (activeSessionCount === 0 || !runtimeReady) {
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
    refreshAgentReadiness,
    runtimeReady,
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
