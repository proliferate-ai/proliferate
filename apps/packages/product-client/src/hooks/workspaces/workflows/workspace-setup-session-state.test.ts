import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureWorkspaceSetupSessionSurface,
} from "#product/hooks/workspaces/workflows/workspace-setup-session-state";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

describe("ensureWorkspaceSetupSessionSurface", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
    useWorkspaceUiStore.setState({
      activeShellTabKeyByWorkspace: {},
      shellActivationEpochByWorkspace: {},
    });
  });

  it("allocates one selected client-only surface and reuses it", () => {
    const first = ensureWorkspaceSetupSessionSurface(
      "workspace-1",
      "logical-workspace-1",
    );
    const second = ensureWorkspaceSetupSessionSurface(
      "workspace-1",
      "logical-workspace-1",
    );

    expect(second).toBe(first);
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(first);
    expect(Object.keys(useSessionDirectoryStore.getState().entriesById)).toEqual([first]);
    expect(useSessionDirectoryStore.getState().entriesById[first]).toMatchObject({
      agentKind: "",
      materializedSessionId: null,
      modelId: null,
      title: "Set up chat",
      workspaceId: "workspace-1",
    });
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace)
      .toMatchObject({ "logical-workspace-1": `chat:${first}` });
  });
});
