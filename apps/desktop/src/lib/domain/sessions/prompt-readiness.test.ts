import { describe, expect, it } from "vitest";
import { canPromptSessionSlot } from "@/lib/domain/sessions/prompt-readiness";

describe("canPromptSessionSlot", () => {
  it("allows hydrated sessions", () => {
    expect(canPromptSessionSlot({
      transcriptHydrated: true,
      streamConnectionState: "disconnected",
    })).toBe(true);
  });

  it("allows unhydrated sessions once their stream is open", () => {
    expect(canPromptSessionSlot({
      transcriptHydrated: false,
      streamConnectionState: "open",
    })).toBe(true);
  });

  it("blocks unhydrated sessions before the stream opens", () => {
    expect(canPromptSessionSlot({
      transcriptHydrated: false,
      streamConnectionState: "connecting",
    })).toBe(false);
  });
});
