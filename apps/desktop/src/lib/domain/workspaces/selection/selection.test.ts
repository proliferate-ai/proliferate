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

  it("prefers prompted sessions over newer setup-only sessions", () => {
    const sessions = [
      { id: "setup-only", updatedAt: "2026-04-07T20:00:00.000Z" },
      {
        id: "prompted",
        lastPromptAt: "2026-04-07T19:00:00.000Z",
        updatedAt: "2026-04-07T19:30:00.000Z",
      },
    ];

    expect(choosePreferredWorkspaceSession(sessions, null)?.id).toBe("prompted");
  });

  it("falls back to the most recently updated session when none are prompted", () => {
    const sessions = [
      { id: "session-1", updatedAt: "2026-04-07T18:00:00.000Z" },
      { id: "session-2", updatedAt: "2026-04-07T19:00:00.000Z" },
    ];

    expect(choosePreferredWorkspaceSession(sessions, null)?.id).toBe("session-2");
  });

  it("never returns null for a non-empty list (bootstrap fallback guarantee)", () => {
    // The bootstrap final-guarantee fallback calls this with a null last-viewed
    // id; it must always resolve to a session so a workspace with >=1 session
    // never strands the user on the empty hero (#14).
    const sessions = [
      { id: "no-timestamps" },
      { id: "setup-only", updatedAt: "2026-04-07T20:00:00.000Z" },
    ];

    expect(choosePreferredWorkspaceSession(sessions, null)).not.toBeNull();
  });

  it("returns null only for an empty list", () => {
    expect(choosePreferredWorkspaceSession([], null)).toBeNull();
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
