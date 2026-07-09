import { describe, expect, it } from "vitest";
import { resolveComposerDockSlots } from "./resolve-dock-slots";

const BASE_INPUT = {
  pendingPromptCount: 0,
  primaryPendingInteractionKind: null,
  hasActiveTodoTracker: false,
  hasDelegatedWork: false,
  hasSessionGoal: false,
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

  it("keeps todo progress as a strip companion while an interaction holds the slot", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      primaryPendingInteractionKind: "permission",
      hasActiveTodoTracker: true,
    }).activeSlotCompanion).toEqual({ kind: "todo_strip" });
  });

  it("omits the strip companion when there is no active todo tracker", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      primaryPendingInteractionKind: "permission",
    }).activeSlotCompanion).toBeNull();
  });

  it("omits the strip companion when the tracker owns the slot itself", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasActiveTodoTracker: true,
    }).activeSlotCompanion).toBeNull();
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
      hasSessionGoal: true,
      hasWorkspaceStatusPanel: true,
    })).toEqual({
      outboundSlot: null,
      activeSlot: null,
      activeSlotCompanion: null,
      attachedSlot: {
        ambientSlot: { kind: "workspace_status" },
        delegatedWork: false,
        sessionGoal: false,
        sessionActivity: false,
      },
    });
  });

  it("attaches the session goal bar on its own", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasSessionGoal: true,
    }).attachedSlot).toEqual({
      ambientSlot: null,
      delegatedWork: false,
      sessionGoal: true,
      sessionActivity: false,
    });
  });

  it("attaches the activity chips bar even with no goal set", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasSessionActivity: true,
    }).attachedSlot).toEqual({
      ambientSlot: null,
      delegatedWork: false,
      sessionGoal: false,
      sessionActivity: true,
    });
  });

  it("keeps activity chips behind the session suppression flag", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      suppressSessionSlots: true,
      hasSessionActivity: true,
    }).attachedSlot).toBeNull();
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
      sessionGoal: false,
      sessionActivity: false,
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
      sessionGoal: false,
      sessionActivity: false,
    });
  });
});
