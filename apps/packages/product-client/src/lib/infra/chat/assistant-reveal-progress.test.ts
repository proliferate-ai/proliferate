import { afterEach, describe, expect, it } from "vitest";
import {
  clearAssistantRevealProgressForTests,
  getAssistantRevealProgress,
  recordAssistantRevealProgress,
} from "#product/lib/infra/chat/assistant-reveal-progress";

afterEach(clearAssistantRevealProgressForTests);

describe("assistant reveal progress", () => {
  it("retains an incomplete visible frontier across row remounts", () => {
    recordAssistantRevealProgress("assistant-item", {
      complete: false,
      phase: "active",
      visibleLength: 27,
      targetLength: 81,
      isStreaming: true,
    });

    expect(getAssistantRevealProgress("assistant-item")).toEqual({
      complete: false,
      phase: "active",
      visibleLength: 27,
      targetLength: 81,
      isStreaming: true,
    });
  });

  it("keeps completed progress so revisiting a row cannot replay it", () => {
    recordAssistantRevealProgress("assistant-item", {
      complete: true,
      phase: "idle",
      visibleLength: 81,
      targetLength: 81,
      isStreaming: false,
    });

    expect(getAssistantRevealProgress("assistant-item")?.visibleLength).toBe(81);
    expect(getAssistantRevealProgress("assistant-item")?.complete).toBe(true);
  });
});
