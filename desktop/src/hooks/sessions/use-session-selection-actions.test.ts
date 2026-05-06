import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { classifyTrustedSessionSelection } from "@/hooks/sessions/use-session-selection-actions";

describe("classifyTrustedSessionSelection", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("promotes a pending mounted session to root when no child hint exists", () => {
    putSessionRecord(
      createEmptySessionRecord("root-session", "codex", {
        workspaceId: "workspace-1",
      }),
    );

    const relationship = classifyTrustedSessionSelection("root-session");

    expect(relationship).toEqual({ kind: "root" });
    expect(useSessionDirectoryStore.getState().entriesById["root-session"]?.sessionRelationship)
      .toEqual({ kind: "root" });
  });

  it("applies and prunes a known child hint instead of promoting to root", () => {
    putSessionRecord(createEmptySessionRecord("child-session", "codex", {
      workspaceId: "workspace-1",
    }));
    useSessionDirectoryStore.getState().recordRelationshipHint("child-session", {
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-1",
    });

    const relationship = classifyTrustedSessionSelection("child-session");

    expect(relationship).toEqual({
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-1",
    });
    expect(useSessionDirectoryStore.getState().entriesById["child-session"]?.sessionRelationship)
      .toEqual(relationship);
    expect(useSessionDirectoryStore.getState().relationshipHintsBySessionId["child-session"])
      .toBeUndefined();
  });
});
