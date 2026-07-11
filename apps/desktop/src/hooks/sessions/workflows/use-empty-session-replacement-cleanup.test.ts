import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginEmptySessionReplacement,
  type EmptySessionReplacementDeps,
} from "@/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { resetSessionCreationSupersessionForTests } from "@/hooks/sessions/workflows/session-creation-supersession";
import {
  committedReplacedSessionTombstonesForWorkspace,
  filterReplacedSessionIds,
  filterReplacedSessionTombstones,
  isReplacedSessionTombstoned,
  resetReplacedSessionTombstonesForTests,
  shouldPreserveStagedReplacementShell,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  resetSessionReplacementDismissalsForTests,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";

const storageMocks = vi.hoisted(() => ({
  writeTombstones: vi.fn(() => true),
}));

vi.mock("@/lib/access/browser/session-replacement-tombstones-storage", () => ({
  readSessionReplacementTombstones: () => ({}),
  writeSessionReplacementTombstones: storageMocks.writeTombstones,
}));

function createDeps() {
  const mutateAsync = vi.fn(async () => undefined);
  const deps: EmptySessionReplacementDeps = {
    closeSessionSlotStream: vi.fn(),
    removeWorkspaceSessionRecord: vi.fn(),
    dismissSessionMutation: { mutateAsync } as never,
  };
  return { deps, mutateAsync };
}

function putUnusedSession() {
  const record = {
    ...createEmptySessionRecord("old-session", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-old",
      modelId: "gpt-5",
    }),
    events: [{ seq: 1, event: { type: "config_option_update" } } as never],
    streamConnectionState: "open" as const,
  };
  putSessionRecord(record);
  return record;
}

beforeEach(() => {
  storageMocks.writeTombstones.mockReset();
  storageMocks.writeTombstones.mockReturnValue(true);
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
  resetSessionCreationSupersessionForTests();
  resetReplacedSessionTombstonesForTests();
  resetSessionReplacementDismissalsForTests();
});

afterEach(() => {
  storageMocks.writeTombstones.mockReturnValue(true);
  resetReplacedSessionTombstonesForTests();
  resetSessionReplacementDismissalsForTests();
});

describe("empty session replacement transaction", () => {
  it("suppresses an unmaterialized old tab through commit", async () => {
    putSessionRecord(createEmptySessionRecord("client-old", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "gpt-5",
    }));
    const { deps, mutateAsync } = createDeps();

    const transaction = beginEmptySessionReplacement(
      "client-old",
      "workspace-1",
      deps,
    );

    expect(transaction).not.toBeNull();
    expect(filterReplacedSessionIds("workspace-1", ["client-old", "client-new"]))
      .toEqual(["client-new"]);
    expect(shouldPreserveStagedReplacementShell("workspace-1", "workspace-1"))
      .toBe(true);

    await transaction?.commit();

    expect(shouldPreserveStagedReplacementShell("workspace-1", "workspace-1"))
      .toBe(false);
    expect(filterReplacedSessionIds("workspace-1", ["client-old", "client-new"]))
      .toEqual(["client-new"]);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("releases an unmaterialized old-tab suppression on rollback", () => {
    putSessionRecord(createEmptySessionRecord("client-old", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: null,
      modelId: "gpt-5",
    }));
    const { deps } = createDeps();

    const transaction = beginEmptySessionReplacement(
      "client-old",
      "workspace-1",
      deps,
    );
    transaction?.rollback();

    expect(getSessionRecord("client-old")).not.toBeNull();
    expect(filterReplacedSessionIds("workspace-1", ["client-old"]))
      .toEqual(["client-old"]);
  });

  it("hides locally at begin and restores the captured shell on rollback", () => {
    const original = putUnusedSession();
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: "old-session",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "plan",
    });
    const { deps, mutateAsync } = createDeps();

    const transaction = beginEmptySessionReplacement(
      "old-session",
      "workspace-1",
      deps,
    );

    expect(transaction).not.toBeNull();
    expect(getSessionRecord("old-session")).toBeNull();
    expect(deps.closeSessionSlotStream).toHaveBeenCalledWith("old-session");
    expect(deps.removeWorkspaceSessionRecord).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    expect(isReplacedSessionTombstoned("workspace-1", "old-session")).toBe(true);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual([]);

    transaction?.rollback();

    expect(getSessionRecord("old-session")).toMatchObject({
      agentKind: original.agentKind,
      events: original.events,
      materializedSessionId: original.materializedSessionId,
      modelId: original.modelId,
      streamConnectionState: "disconnected",
      transcript: original.transcript,
      workspaceId: original.workspaceId,
    });
    expect(useSessionIntentStore.getState().intentIdsByClientSessionId["old-session"])
      .toHaveLength(1);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(false);
  });

  it("defers cache removal and runtime dismissal until commit", async () => {
    putUnusedSession();
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: "old-session",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "plan",
    });
    const { deps, mutateAsync } = createDeps();
    const transaction = beginEmptySessionReplacement(
      "old-session",
      "workspace-1",
      deps,
    );

    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);

    await transaction?.commit();

    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-old"]);
    expect(deps.removeWorkspaceSessionRecord)
      .toHaveBeenCalledWith("workspace-1", "runtime-old");
    expect(useSessionIntentStore.getState().intentIdsByClientSessionId["old-session"] ?? [])
      .toEqual([]);
    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        sessionId: "runtime-old",
      });
    });
  });

  it("retries a transient dismissal and retains the tombstone until authoritative refresh", async () => {
    putUnusedSession();
    const { deps, mutateAsync } = createDeps();
    mutateAsync.mockRejectedValueOnce(new Error("temporary disconnect"));
    const transaction = beginEmptySessionReplacement(
      "old-session",
      "workspace-1",
      deps,
    );

    await transaction?.commit();

    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(2);
    });
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
  });

  it("keeps a failed dismissal tombstoned out of authoritative refreshes", async () => {
    putUnusedSession();
    const { deps, mutateAsync } = createDeps();
    mutateAsync.mockRejectedValue(new Error("runtime unavailable"));
    const transaction = beginEmptySessionReplacement(
      "old-session",
      "workspace-1",
      deps,
    );

    await transaction?.commit();

    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(3);
    });
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    expect(filterReplacedSessionTombstones("workspace-1", [
      { id: "runtime-old" },
      { id: "runtime-new" },
    ])).toEqual([{ id: "runtime-new" }]);
  });

  it("restores the old session when persistence and dismissal both fail", async () => {
    const original = putUnusedSession();
    storageMocks.writeTombstones.mockReturnValue(false);
    const { deps, mutateAsync } = createDeps();
    mutateAsync.mockRejectedValue(new Error("runtime unavailable"));
    const transaction = beginEmptySessionReplacement(
      "old-session",
      "workspace-1",
      deps,
    );

    await expect(transaction?.commit()).resolves.toBe("retained");

    expect(mutateAsync).toHaveBeenCalledTimes(3);
    expect(getSessionRecord("old-session")).toMatchObject({
      materializedSessionId: original.materializedSessionId,
      streamConnectionState: "disconnected",
    });
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(false);
    expect(deps.removeWorkspaceSessionRecord).not.toHaveBeenCalled();
  });

  it("does not replace a session with a queued prompt", () => {
    putUnusedSession();
    useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "old-session",
      workspaceId: "workspace-1",
      text: "do work",
      blocks: [{ type: "text", text: "do work" }],
    });
    const { deps } = createDeps();

    const transaction = beginEmptySessionReplacement(
      "old-session",
      "workspace-1",
      deps,
    );

    expect(transaction).toBeNull();
    expect(getSessionRecord("old-session")).not.toBeNull();
    expect(deps.closeSessionSlotStream).not.toHaveBeenCalled();
  });
});
