import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionViewState } from "#product/domain/sessions/activity";
import type { SessionStreamConnectionState } from "#product/lib/domain/sessions/directory/directory-entry";
import { prepareSessionStreamConnection } from "#product/hooks/sessions/lifecycle/session-stream-connection-prepare";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const CLIENT_SESSION_ID = "client-session-1";
const RUNTIME_SESSION_ID = "runtime-session-1";

describe("prepareSessionStreamConnection", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  afterEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("reconciles terminal runtime state when initial history hydration fails", async () => {
    putStaleWorkingShell("disconnected");
    const rehydrateSessionSlotFromHistory = vi.fn().mockResolvedValue(false);
    const refreshSessionSlotMeta = vi.fn(async () => {
      reconcileShellAsIdle();
    });

    const shouldOpenStream = await prepareSessionStreamConnection(
      CLIENT_SESSION_ID,
      {
        allowColdIdleNoStream: true,
        hydrateBeforeStream: true,
        resumeIfActive: true,
        skipInitialRefresh: true,
      },
      {
        refreshSessionSlotMeta,
        rehydrateSessionSlotFromHistory,
      },
    );

    expect(rehydrateSessionSlotFromHistory).toHaveBeenCalledOnce();
    expect(refreshSessionSlotMeta).toHaveBeenCalledOnce();
    expect(shouldOpenStream).toBe(false);
    expect(getSessionRecord(CLIENT_SESSION_ID)?.transcriptHydrated).toBe(false);
    expect(resolveSessionViewState(getSessionRecord(CLIENT_SESSION_ID))).toBe("idle");
  });

  it.each(["connecting", "open"] as const)(
    "refreshes metadata after failed hydration with an existing %s stream",
    async (streamConnectionState) => {
      putStaleWorkingShell(streamConnectionState);
      const rehydrateSessionSlotFromHistory = vi.fn().mockResolvedValue(false);
      const refreshSessionSlotMeta = vi.fn(async () => {
        reconcileShellAsIdle();
      });

      const shouldOpenStream = await prepareSessionStreamConnection(
        CLIENT_SESSION_ID,
        {
          hydrateBeforeStream: true,
          skipInitialRefresh: true,
        },
        {
          refreshSessionSlotMeta,
          rehydrateSessionSlotFromHistory,
        },
      );

      expect(refreshSessionSlotMeta).toHaveBeenCalledOnce();
      expect(shouldOpenStream).toBe(false);
      expect(getSessionRecord(CLIENT_SESSION_ID)?.transcriptHydrated).toBe(false);
    },
  );

  it("preserves the connected fast path after successful hydration", async () => {
    putStaleWorkingShell("open");
    const rehydrateSessionSlotFromHistory = vi.fn().mockResolvedValue(true);
    const refreshSessionSlotMeta = vi.fn();

    const shouldOpenStream = await prepareSessionStreamConnection(
      CLIENT_SESSION_ID,
      {
        hydrateBeforeStream: true,
        skipInitialRefresh: true,
      },
      {
        refreshSessionSlotMeta,
        rehydrateSessionSlotFromHistory,
      },
    );

    expect(refreshSessionSlotMeta).not.toHaveBeenCalled();
    expect(shouldOpenStream).toBe(false);
    expect(getSessionRecord(CLIENT_SESSION_ID)?.transcriptHydrated).toBe(true);
  });
});

function putStaleWorkingShell(streamConnectionState: SessionStreamConnectionState): void {
  const record = createEmptySessionRecord(CLIENT_SESSION_ID, "codex", {
    workspaceId: "workspace-1",
    materializedSessionId: RUNTIME_SESSION_ID,
    executionSummary: {
      phase: "running",
      hasLiveHandle: true,
      pendingInteractions: [],
      updatedAt: "2026-08-17T21:48:00Z",
    },
  });
  putSessionRecord({
    ...record,
    status: "running",
    streamConnectionState,
    transcriptHydrated: false,
    transcript: {
      ...record.transcript,
      isStreaming: true,
    },
  });
}

function reconcileShellAsIdle(): void {
  useSessionDirectoryStore.getState().patchEntry(CLIENT_SESSION_ID, {
    status: "idle",
    executionSummary: {
      phase: "idle",
      hasLiveHandle: false,
      pendingInteractions: [],
      updatedAt: "2026-08-17T21:49:00Z",
    },
  });
}
