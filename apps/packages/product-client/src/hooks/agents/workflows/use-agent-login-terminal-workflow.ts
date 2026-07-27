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
  const isCloudSurface = surface === "cloud";
  const { invalidateAgentLaunchReadinessResources } = useAgentResourcesCache();
  const startLoginTerminal = useStartAgentLoginTerminalMutation();
  const closeLoginTerminal = useCloseAgentLoginTerminalMutation();
  const [sessionsByKind, setSessionsByKind] = useState<Record<string, AgentLoginTerminalSession>>({});
  // Minted in openAuthTerminal (cloud only) on every explicit open/restart —
  // never persisted from a prior scope, so switching sandboxes or users can
  // never reuse a stale token. It IS reused across a WS reconnect/replay
  // within the SAME open session (the viewport's own retry path never calls
  // openAuthTerminal again) — that's fine because it is the 7-day product
  // JWT, not a short-lived per-connection credential; a genuinely expired
  // token surfaces as a 401 the user clears by clicking "Restart auth".
  const [cloudAuthToken, setCloudAuthToken] = useState<string | undefined>(undefined);

  // On cloud, the AnyHarness runtime context is ALREADY the sandbox gateway
  // (CloudAnyHarnessRuntimeProvider wraps HarnessPane's cloud branch and sets
  // context runtimeUrl = cloudSandboxGatewayRuntimeUrl(cloudClient)) — re-
  // deriving it here would just recompute the same value from the same
  // client. Local keeps the harness-connection-store fallback for the boot
  // window where the context hasn't caught up to the store yet.
  const runtimeConnection = useMemo(() => ({
    baseUrl: isCloudSurface
      ? (runtime.runtimeUrl?.trim() ?? "")
      : (runtime.runtimeUrl?.trim() || runtimeUrl.trim()),
    authToken: isCloudSurface ? cloudAuthToken : (runtime.authToken ?? undefined),
    // Cloud carries the 7-day product JWT and MUST ride the WS subprotocol,
    // never the query string (matches every other cloud WS path — see
    // cloud-sandbox-gateway.ts, use-terminal-stream-controller.ts). Local's
    // short-lived local-runtime token has no such requirement.
    webSocketAuthTransport: (isCloudSurface ? "protocol" : undefined) as
      | "protocol"
      | undefined,
  }), [cloudAuthToken, isCloudSurface, runtime.authToken, runtime.runtimeUrl, runtimeUrl]);
  // On cloud this is a coarse "is a client even configured" check, not a live
  // sandbox-health signal — CloudAnyHarnessRuntimeProvider always resolves a
  // base URL once cloudClient exists, whether or not the sandbox is actually
  // reachable. That is a deliberate choice, not an oversight: cloud has no
  // local "connecting/failed" boot sequence to gate on the way the desktop
  // runtime does (see the `else` branch), and the real reachability check is
  // the openAuthTerminal mutation itself — a dead/cold sandbox surfaces there
  // as a caught error (errorMessage), not as a false "ready" that then hangs.
  // This value only gates a fast client-side rejection before ever calling
  // the mutation; it deliberately does NOT drive the periodic poll (see the
  // effect below, which is local-only for the same reason).
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
    // Deliberately local-only. The poll's job is to catch the local desktop
    // CLI writing its own credential file mid-login (no push notification
    // exists for that). On cloud, `runtimeReady` is tautologically true the
    // instant a client resolves a base URL — it carries no live "is the
    // sandbox actually up" signal — so a timer here would be an unconditional
    // 2.5s GET against ensure_cloud_sandbox_gateway_access for as long as the
    // terminal stays open, which can provision/wake a cold sandbox purely to
    // poll. The start mutation's own catch already surfaces a dead sandbox as
    // errorMessage; close/exit still force one refresh (closeAuthTerminal /
    // handleTerminalExit below) so readiness catches up once the user is done.
    if (isCloudSurface || activeSessionCount === 0 || !runtimeReady) {
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
    isCloudSurface,
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
