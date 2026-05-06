import { beforeEach, describe, expect, it } from "vitest";
import {
  recordLinkedChildRelationshipHint,
  recordSubagentChildRelationshipHint,
} from "@/hooks/sessions/session-relationship-hints";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

describe("session relationship hint helpers", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("records subagent child hints before a slot exists", () => {
    recordSubagentChildRelationshipHint({
      sessionId: "child-session",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      workspaceId: "workspace-1",
    });

    expect(useSessionDirectoryStore.getState().relationshipHintsBySessionId["child-session"])
      .toEqual({
        kind: "subagent_child",
        parentSessionId: "parent-session",
        sessionLinkId: "link-1",
        relation: "subagent",
        workspaceId: "workspace-1",
      });
  });

  it("applies linked child hints to existing pending slots", () => {
    putSessionRecord(
      createEmptySessionRecord("child-session", "codex", {
        workspaceId: "workspace-1",
      }),
    );

    recordLinkedChildRelationshipHint({
      sessionId: "child-session",
      parentSessionId: "parent-session",
      relation: "header_child",
      workspaceId: "workspace-1",
    });

    expect(useSessionDirectoryStore.getState().entriesById["child-session"]?.sessionRelationship)
      .toEqual({
        kind: "linked_child",
        parentSessionId: "parent-session",
        sessionLinkId: null,
        relation: "header_child",
        workspaceId: "workspace-1",
      });
  });
});
