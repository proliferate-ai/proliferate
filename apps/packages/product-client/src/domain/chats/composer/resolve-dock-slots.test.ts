import { describe, expect, it } from "vitest";
import { resolveComposerDockSlots } from "./resolve-dock-slots";

const BASE_INPUT = {
  pendingPromptCount: 0,
  primaryPendingInteractionKind: null,
  hasDelegatedWork: false,
  hasWorkspaceActivity: false,
  hasSessionGoal: false,
} as const;

describe("resolveComposerDockSlots", () => {
  it("surfaces a blocking interaction as the active slot", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      primaryPendingInteractionKind: "permission",
    }).activeSlot).toEqual({ kind: "permission" });
  });

  it("leaves the active slot empty when there is no blocking interaction", () => {
    expect(resolveComposerDockSlots(BASE_INPUT).activeSlot).toBeNull();
  });

  it("keeps workspace activity while suppressing session-owned slots", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      suppressSessionSlots: true,
      pendingPromptCount: 2,
      recoveredPromptCount: 1,
      primaryPendingInteractionKind: "user_input",
      hasWorkspaceActivity: true,
      hasSessionGoal: true,
    })).toEqual({
      outboundSlot: null,
      activeSlot: null,
      attachedSlot: {
        delegatedWork: false,
        workspaceActivity: true,
        sessionGoal: false,
        sessionActivity: false,
      },
    });
  });

  it("surfaces recoverable prompts ahead of ordinary queued prompts", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      pendingPromptCount: 2,
      recoveredPromptCount: 1,
    }).outboundSlot).toEqual({ kind: "prompt_recoveries" });
  });

  it("attaches the session goal bar on its own", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasSessionGoal: true,
    }).attachedSlot).toEqual({
      delegatedWork: false,
      workspaceActivity: false,
      sessionGoal: true,
      sessionActivity: false,
    });
  });

  it("attaches the activity chips bar even with no goal set", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasSessionActivity: true,
    }).attachedSlot).toEqual({
      delegatedWork: false,
      workspaceActivity: false,
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

  it("keeps delegated work and workspace activity attached together", () => {
    expect(resolveComposerDockSlots({
      ...BASE_INPUT,
      hasDelegatedWork: true,
      hasWorkspaceActivity: true,
    }).attachedSlot).toEqual({
      delegatedWork: true,
      workspaceActivity: true,
      sessionGoal: false,
      sessionActivity: false,
    });
  });
});
