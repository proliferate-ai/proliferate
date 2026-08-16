import type { TerminalRecord } from "@anyharness/sdk";
import { useCallback } from "react";
import { useTerminalCache } from "#product/hooks/access/anyharness/terminals/use-terminal-cache";
import { useTerminalWorkspaceConnection } from "#product/hooks/terminals/workflows/use-terminal-workspace-connection";
import {
  adoptTerminalStreamIdentity,
  ensureConnected,
  hasActiveHandle,
  markExited,
  markReadOnly,
  type TerminalStreamIdentity,
} from "#product/lib/infra/terminals/terminal-stream-registry";
import { isTerminalIntentionalClose } from "#product/lib/infra/terminals/terminal-close-intent";
import { createTerminalRuntimeIdentity } from "#product/lib/infra/terminals/terminal-stream-key";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useTerminalStore } from "#product/stores/terminal/terminal-store";
import {
  abandonRendererFlow,
  beginRendererFlow,
  finishRendererFlow,
  markRendererFlowDataReady,
  markRendererFlowShellCommitted,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";

// Owns terminal stream attachment and reconnect wiring. Rendering stays in components.
export function useTerminalStreamController() {
  const { invalidateWorkspaceTerminals } = useTerminalCache();
  const {
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
    triggerSelectedCloudReconnect,
  } = useTerminalWorkspaceConnection();
  const markUnread = useTerminalStore((state) => state.markUnread);
  const bumpConnectionVersion = useTerminalStore((state) => state.bumpConnectionVersion);

  const attachTerminalStream = useCallback(async (
    terminalId: string,
    workspaceId: string,
    workspaceConnection?: Awaited<ReturnType<typeof resolveTerminalWorkspaceConnection>>,
    options?: { readOnlyReplay?: boolean },
  ): Promise<TerminalStreamIdentity | null> => {
    if (isTerminalIntentionalClose(terminalId)) {
      return null;
    }

    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return null;
    }

    // UX-latency R1 canonical flow marks (intent -> shell -> data -> stable).
    beginRendererFlow({
      kind: "terminal_attach",
      correlationKey: terminalId,
      correlation: { workspaceId, targetId: terminalId },
    });
    const resolvedConnection =
      workspaceConnection ?? await resolveTerminalWorkspaceConnection(workspaceId);
    const identity: TerminalStreamIdentity = {
      workspaceId,
      terminalId,
      runtimeIdentity: createTerminalRuntimeIdentity({
        runtimeUrl: resolvedConnection.runtimeUrl,
        anyharnessWorkspaceId: resolvedConnection.anyharnessWorkspaceId,
        runtimeGeneration: resolvedConnection.runtimeGeneration,
      }),
    };
    let sawExitEvent = false;
    let sawFirstData = false;
    const didConnect = ensureConnected({
      identity,
      baseUrl: resolvedConnection.runtimeUrl,
      authToken: resolvedConnection.authToken,
      webSocketAuthTransport: resolvedConnection.webSocketAuthTransport,
      readOnly: options?.readOnlyReplay,
      onOpen: () => {
        markRendererFlowDataReady({ kind: "terminal_attach", correlationKey: terminalId });
      },
      onData: () => {
        if (!sawFirstData) {
          sawFirstData = true;
          finishRendererFlow({ kind: "terminal_attach", correlationKey: terminalId });
        }
        const state = useTerminalStore.getState();
        const activeWsId = useSessionSelectionStore.getState().selectedWorkspaceId;
        const activeTerminalId = activeWsId
          ? state.activeTerminalByWorkspace[activeWsId]
          : null;
        if (activeTerminalId !== terminalId) {
          markUnread(terminalId);
        }
      },
      onExit: () => {
        sawExitEvent = true;
        bumpConnectionVersion(terminalId);
        void invalidateWorkspaceTerminals(workspaceId);
      },
      onError: () => {
        abandonRendererFlow({
          kind: "terminal_attach",
          correlationKey: terminalId,
          reason: "stream_error",
        });
        bumpConnectionVersion(terminalId);
        if (!options?.readOnlyReplay && !isTerminalIntentionalClose(terminalId)) {
          triggerSelectedCloudReconnect(workspaceId);
        }
      },
      onClose: () => {
        if (options?.readOnlyReplay && !sawExitEvent) {
          sawExitEvent = true;
          markExited(identity, null);
          bumpConnectionVersion(terminalId);
          return;
        }
        bumpConnectionVersion(terminalId);
        if (!options?.readOnlyReplay && !isTerminalIntentionalClose(terminalId) && !sawExitEvent) {
          triggerSelectedCloudReconnect(workspaceId);
        }
      },
    });
    if (didConnect) {
      // The terminal shell is present once its runtime connection is resolved
      // AND ensureConnected has confirmed this is a real (fresh) attach, not a
      // keep-alive reattach onto an already-connected/exited entry. Marking
      // this before didConnect was known let reattaches contaminate
      // terminal_attach aggregations with spurious near-0ms shell_committed
      // samples.
      markRendererFlowShellCommitted({ kind: "terminal_attach", correlationKey: terminalId });
      bumpConnectionVersion(terminalId);
    } else {
      // Keep-alive reattach: ensureConnected short-circuits on an existing
      // handle (or an already-exited entry) without firing onOpen/onData, so
      // this flow would never reach data_ready/content_stable. We abandon it
      // rather than leave a truncated flow to age out via prune. Reattach is
      // deliberately UNMEASURED this rung: the interesting cost (first paint of
      // a fresh attach) already happened on the original attach, so remeasuring
      // a keep-alive reattach would report a near-zero, misleading timing.
      abandonRendererFlow({
        kind: "terminal_attach",
        correlationKey: terminalId,
        reason: "already_connected",
      });
    }
    return identity;
  }, [
    bumpConnectionVersion,
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceTerminals,
    markUnread,
    resolveTerminalWorkspaceConnection,
    triggerSelectedCloudReconnect,
  ]);

  const ensureTabConnection = useCallback(async (
    terminalId: string,
    workspaceId: string,
    status: TerminalRecord["status"],
  ): Promise<TerminalStreamIdentity | null> => {
    if (isTerminalIntentionalClose(terminalId)) {
      return null;
    }
    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return null;
    }
    const connection = await resolveTerminalWorkspaceConnection(workspaceId);
    const identity: TerminalStreamIdentity = {
      workspaceId,
      terminalId,
      runtimeIdentity: createTerminalRuntimeIdentity({
        runtimeUrl: connection.runtimeUrl,
        anyharnessWorkspaceId: connection.anyharnessWorkspaceId,
        runtimeGeneration: connection.runtimeGeneration,
      }),
    };
    adoptTerminalStreamIdentity(identity);
    if (status === "exited" || status === "failed") {
      markReadOnly(identity);
      if (hasActiveHandle(identity)) {
        return identity;
      }
      return attachTerminalStream(terminalId, workspaceId, connection, {
        readOnlyReplay: true,
      });
    }
    if (hasActiveHandle(identity)) {
      return identity;
    }
    return attachTerminalStream(terminalId, workspaceId, connection);
  }, [
    attachTerminalStream,
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
  ]);

  return {
    ensureTabConnection,
  };
}
