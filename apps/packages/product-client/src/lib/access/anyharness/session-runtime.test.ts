import { beforeEach, describe, expect, it } from "vitest";
import { getSessionClientAndWorkspace } from "#product/lib/access/anyharness/session-runtime";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

describe("getSessionClientAndWorkspace materialized-id resolution", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useHarnessConnectionStore.getState().setRuntimeUrl("http://127.0.0.1:8457");
    useSessionSelectionStore.setState({ selectedWorkspaceId: "workspace-1" });
  });

  it("resolves a runtime session id with no directory entry to itself", async () => {
    // Closed sessions listed from the runtime never get a directory entry
    // until activated; dismissing one from the History menu must still
    // address it by its own id (PRO-157).
    const resolved = await getSessionClientAndWorkspace("runtime-session-1", null, null);

    expect(resolved.materializedSessionId).toBe("runtime-session-1");
    expect(resolved.workspaceId).toBe("workspace-1");
  });

  it("prefers the directory mapping when a record exists", async () => {
    putSessionRecord(createEmptySessionRecord("client-session:codex:1", "codex", {
      materializedSessionId: "runtime-a",
      workspaceId: "workspace-2",
    }));

    const resolved = await getSessionClientAndWorkspace("client-session:codex:1", null, null);

    expect(resolved.materializedSessionId).toBe("runtime-a");
    expect(resolved.workspaceId).toBe("workspace-2");
  });

  it("keeps failing fast for ids that are still materializing", async () => {
    putSessionRecord(createEmptySessionRecord("client-session:codex:2", "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-1",
    }));

    await expect(getSessionClientAndWorkspace("client-session:codex:2", null, null))
      .rejects.toThrow("Session is still starting");
  });
});
