import { describe, expect, it } from "vitest";
import { resolveChatLoadingSubstep } from "./chat-loading-substep";

const BASE_INPUT = {
  activeSessionId: "session-1",
  selectedWorkspaceId: "workspace-1",
  hasBootstrappedWorkspace: false,
  hasSlot: true,
  streamConnectionState: "open",
  transcriptHydrated: true,
  isEmpty: false,
  isRunning: false,
} as const;

describe("resolveChatLoadingSubstep", () => {
  it("shows workspace bootstrap before a session exists", () => {
    expect(resolveChatLoadingSubstep({
      ...BASE_INPUT,
      activeSessionId: null,
    })).toBe("bootstrapping-workspace");
  });

  it("shows opening session after workspace bootstrap completed without a session", () => {
    expect(resolveChatLoadingSubstep({
      ...BASE_INPUT,
      activeSessionId: null,
      hasBootstrappedWorkspace: true,
    })).toBe("opening-session");
  });

  it("shows opening session before the session slot exists", () => {
    expect(resolveChatLoadingSubstep({
      ...BASE_INPUT,
      hasSlot: false,
    })).toBe("opening-session");
  });

  it("shows connecting stream while history is unhydrated and stream is not open", () => {
    expect(resolveChatLoadingSubstep({
      ...BASE_INPUT,
      streamConnectionState: "connecting",
      transcriptHydrated: false,
    })).toBe("connecting-stream");
  });

  it("shows loading history once stream is open and hydration is pending", () => {
    expect(resolveChatLoadingSubstep({
      ...BASE_INPUT,
      transcriptHydrated: false,
    })).toBe("loading-history");
  });

  it("shows awaiting first turn for an empty running session", () => {
    expect(resolveChatLoadingSubstep({
      ...BASE_INPUT,
      isEmpty: true,
      isRunning: true,
    })).toBe("awaiting-first-turn");
  });
});
