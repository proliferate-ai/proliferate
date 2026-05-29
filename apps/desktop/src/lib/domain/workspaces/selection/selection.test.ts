import { describe, expect, it } from "vitest";
import {
  choosePreferredWorkspaceSession,
  getLatestWorkspaceInteractionTimestamp,
  hasHiddenDismissedWorkspaceSessions,
} from "./selection";

describe("hasHiddenDismissedWorkspaceSessions", () => {
  it("detects hidden dismissed sessions when the visible list is empty", () => {
    expect(
      hasHiddenDismissedWorkspaceSessions([], [{ id: "session-1" }]),
    ).toBe(true);
  });

  it("returns false when the visible and full session lists match", () => {
    expect(
      hasHiddenDismissedWorkspaceSessions(
        [{ id: "session-1" }],
        [{ id: "session-1" }],
      ),
    ).toBe(false);
  });
});

describe("choosePreferredWorkspaceSession", () => {
  it("prefers the last viewed session when it is still visible", () => {
    const sessions = [
      { id: "session-1", updatedAt: "2026-04-07T18:00:00.000Z" },
      { id: "session-2", updatedAt: "2026-04-07T19:00:00.000Z" },
    ];

    expect(choosePreferredWorkspaceSession(sessions, "session-1")?.id).toBe("session-1");
  });
});

describe("getLatestWorkspaceInteractionTimestamp", () => {
  it("returns the newest prompt or update timestamp", () => {
    const sessions = [
      { id: "session-1", updatedAt: "2026-04-07T18:00:00.000Z" },
      { id: "session-2", lastPromptAt: "2026-04-07T19:00:00.000Z" },
    ];

    expect(getLatestWorkspaceInteractionTimestamp(sessions)).toBe(
      "2026-04-07T19:00:00.000Z",
    );
  });
});
