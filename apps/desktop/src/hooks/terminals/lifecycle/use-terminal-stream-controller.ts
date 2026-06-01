import type { TerminalRecord } from "@anyharness/sdk";
import { useCallback } from "react";
import { useTerminalCache } from "@/hooks/access/anyharness/terminals/use-terminal-cache";
import { useTerminalWorkspaceConnection } from "@/hooks/terminals/workflows/use-terminal-workspace-connection";
import {
  adoptTerminalStreamIdentity,
  ensureConnected,
  hasActiveHandle,
  markExited,
  markReadOnly,
  type TerminalStreamIdentity,
} from "@/lib/infra/terminals/terminal-stream-registry";
import { isTerminalIntentionalClose } from "@/lib/infra/terminals/terminal-close-intent";
import { createTerminalRuntimeIdentity } from "@/lib/infra/terminals/terminal-stream-key";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useTerminalStore } from "@/stores/terminal/terminal-store";

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
    const didConnect = ensureConnected({
      identity,
      baseUrl: resolvedConnection.runtimeUrl,
      authToken: resolvedConnection.authToken,
      readOnly: options?.readOnlyReplay,
      onOpen: () => {},
      onData: () => {
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
      bumpConnectionVersion(terminalId);
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
