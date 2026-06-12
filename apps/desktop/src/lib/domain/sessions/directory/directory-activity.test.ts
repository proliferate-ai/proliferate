import { describe, expect, it } from "vitest";
import { isSessionSlotBusy } from "@proliferate/product-domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import { createDirectoryEntry } from "@/lib/domain/sessions/directory/directory-entry";

describe("activity snapshot from directory entry", () => {
  it("presents a never-prompted starting entry as not busy", () => {
    const entry = createDirectoryEntry({
      sessionId: "session-a",
      agentKind: "proliferate",
      status: "starting",
    });

    expect(isSessionSlotBusy(activitySnapshotFromDirectoryEntry(entry))).toBe(false);
  });

  it("keeps a starting entry busy once a prompt attempt is recorded", () => {
    const entry = createDirectoryEntry({
      sessionId: "session-a",
      agentKind: "proliferate",
      status: "starting",
      hasAttemptedPrompt: true,
    });

    expect(isSessionSlotBusy(activitySnapshotFromDirectoryEntry(entry))).toBe(true);
  });

  it("keeps a starting entry busy once a prompt timestamp exists", () => {
    const entry = createDirectoryEntry({
      sessionId: "session-a",
      agentKind: "proliferate",
      status: "starting",
      lastPromptAt: "2026-06-04T09:00:00Z",
    });

    expect(isSessionSlotBusy(activitySnapshotFromDirectoryEntry(entry))).toBe(true);
  });
});
