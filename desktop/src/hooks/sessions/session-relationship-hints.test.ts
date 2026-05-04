import { beforeEach, describe, expect, it } from "vitest";
import { createEmptySessionSlot } from "@/lib/integrations/anyharness/session-runtime";
import {
  recordLinkedChildRelationshipHint,
  recordSubagentChildRelationshipHint,
} from "@/hooks/sessions/session-relationship-hints";
import { useHarnessStore } from "@/stores/sessions/harness-store";

describe("session relationship hint helpers", () => {
  beforeEach(() => {
    useHarnessStore.setState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
      sessionSlots: {},
      sessionRelationshipHints: {},
    });
  });

  it("records subagent child hints before a slot exists", () => {
    recordSubagentChildRelationshipHint({
      sessionId: "child-session",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      workspaceId: "workspace-1",
    });

    expect(useHarnessStore.getState().sessionRelationshipHints["child-session"])
      .toEqual({
        kind: "subagent_child",
        parentSessionId: "parent-session",
        sessionLinkId: "link-1",
        relation: "subagent",
        workspaceId: "workspace-1",
      });
  });

  it("applies linked child hints to existing pending slots", () => {
    useHarnessStore.getState().putSessionSlot(
      "child-session",
      createEmptySessionSlot("child-session", "codex", {
        workspaceId: "workspace-1",
      }),
    );

    recordLinkedChildRelationshipHint({
      sessionId: "child-session",
      parentSessionId: "parent-session",
      relation: "header_child",
      workspaceId: "workspace-1",
    });

    expect(useHarnessStore.getState().sessionSlots["child-session"].sessionRelationship)
      .toEqual({
        kind: "linked_child",
        parentSessionId: "parent-session",
        sessionLinkId: null,
        relation: "header_child",
        workspaceId: "workspace-1",
      });
  });
});
