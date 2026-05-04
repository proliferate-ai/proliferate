import { beforeEach, describe, expect, it } from "vitest";
import { createEmptySessionSlot } from "@/lib/integrations/anyharness/session-runtime";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { classifyTrustedSessionSelection } from "@/hooks/sessions/use-session-selection-actions";

describe("classifyTrustedSessionSelection", () => {
  beforeEach(() => {
    useHarnessStore.setState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
      sessionSlots: {},
      sessionRelationshipHints: {},
    });
  });

  it("promotes a pending mounted session to root when no child hint exists", () => {
    useHarnessStore.getState().putSessionSlot(
      "root-session",
      createEmptySessionSlot("root-session", "codex", {
        workspaceId: "workspace-1",
      }),
    );

    const relationship = classifyTrustedSessionSelection("root-session");

    expect(relationship).toEqual({ kind: "root" });
    expect(useHarnessStore.getState().sessionSlots["root-session"].sessionRelationship)
      .toEqual({ kind: "root" });
  });

  it("applies and prunes a known child hint instead of promoting to root", () => {
    useHarnessStore.setState({
      sessionSlots: {
        "child-session": createEmptySessionSlot("child-session", "codex", {
          workspaceId: "workspace-1",
        }),
      },
      sessionRelationshipHints: {
        "child-session": {
          kind: "subagent_child",
          parentSessionId: "parent-session",
          sessionLinkId: "link-1",
          relation: "subagent",
          workspaceId: "workspace-1",
        },
      },
    });

    const relationship = classifyTrustedSessionSelection("child-session");

    expect(relationship).toEqual({
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-1",
    });
    expect(useHarnessStore.getState().sessionSlots["child-session"].sessionRelationship)
      .toEqual(relationship);
    expect(useHarnessStore.getState().sessionRelationshipHints["child-session"])
      .toBeUndefined();
  });
});
