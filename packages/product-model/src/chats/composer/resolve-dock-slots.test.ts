import { describe, expect, it } from "vitest";
import { resolveComposerDockSlots } from "./resolve-dock-slots";

const BASE_INPUT = {
  pendingPromptCount: 0,
  primaryPendingInteractionKind: null,
  hasActiveTodoTracker: false,
  hasDelegatedWork: false,
  hasWorkspaceStatusPanel: false,
  hasCloudRuntimePanel: false,
} as const;

describe("resolveComposerDockSlots", () => {
  it("prioritizes blocking interactions over todo state", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      primaryPendingInteractionKind: "permission",
      hasActiveTodoTracker: true,
    }).activeSlot).toEqual({ kind: "permission" });
  });

  it("uses todo state only when no blocking interaction exists", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasActiveTodoTracker: true,
    }).activeSlot).toEqual({ kind: "todo_tracker" });
  });

  it("keeps outbound prompts and delegated work behind the session suppression flag", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      suppressSessionSlots: true,
      pendingPromptCount: 2,
      primaryPendingInteractionKind: "user_input",
      hasActiveTodoTracker: true,
      hasDelegatedWork: true,
      hasWorkspaceStatusPanel: true,
    })).toEqual({
      outboundSlot: null,
      activeSlot: null,
      attachedSlot: {
        ambientSlot: { kind: "workspace_status" },
        delegatedWork: false,
      },
    });
  });

  it("prioritizes workspace status over cloud runtime ambient context", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasWorkspaceStatusPanel: true,
      hasCloudRuntimePanel: true,
      hasDelegatedWork: true,
    }).attachedSlot).toEqual({
      ambientSlot: { kind: "workspace_status" },
      delegatedWork: true,
    });
  });

  it("suppresses ambient context independently from session slots", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      suppressWorkspaceStatusPanels: true,
      hasWorkspaceStatusPanel: true,
      hasCloudRuntimePanel: true,
      hasDelegatedWork: true,
    }).attachedSlot).toEqual({
      ambientSlot: null,
      delegatedWork: true,
    });
  });
});
