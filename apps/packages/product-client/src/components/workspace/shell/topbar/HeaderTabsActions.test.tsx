// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClosedSessionsTrigger } from "#product/components/workspace/shell/topbar/HeaderTabsActions";
import type { HeaderChatMenuEntry } from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

afterEach(cleanup);

const CLOSED_SESSIONS: HeaderChatMenuEntry[] = [
  closedSession("session-1", "Session one"),
  closedSession("session-2", "Session two"),
  closedSession("session-3", "Session three"),
];

describe("ClosedSessionsTrigger", () => {
  it("keeps the popover open after deleting a session when other sessions remain", async () => {
    const onDeleteSession = vi.fn();
    renderClosedSessions({ onDeleteSession });

    openClosedSessions(3);
    fireEvent.click(screen.getByRole("button", { name: "Delete Session two" }));

    expect(onDeleteSession).toHaveBeenCalledWith("session-2");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Session two" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Session one" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Session three" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Closed sessions (2)", hidden: true }).getAttribute("data-state"),
    ).toBe("open");
  });

  it("still closes the popover after restoring a session", async () => {
    const onRestoreSession = vi.fn();
    renderClosedSessions({ onRestoreSession });

    openClosedSessions(3);
    fireEvent.click(screen.getByRole("button", { name: "Session one" }));

    expect(onRestoreSession).toHaveBeenCalledWith("session-1");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Session one" })).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Closed sessions (3)", hidden: true }).getAttribute("data-state"),
    ).toBe("closed");
  });

  it("still closes the popover on Escape", async () => {
    renderClosedSessions();

    openClosedSessions(3);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Session one" })).toBeNull();
    });
  });

  it("still closes the popover on an outside pointer interaction", async () => {
    renderClosedSessions();

    openClosedSessions(3);
    // Radix installs the outside-pointer listener on the next timer and
    // defers primary-pointer dismissal through the matching click.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Session one" })).toBeNull();
    });
  });

  it("removes the trigger after deleting the final closed session", async () => {
    renderClosedSessions({ initialRows: [CLOSED_SESSIONS[0]] });

    openClosedSessions(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete Session one" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Closed sessions/ })).toBeNull();
    });
  });
});

function ClosedSessionsHarness({
  initialRows,
  onDeleteSession,
  onRestoreSession,
}: {
  initialRows: HeaderChatMenuEntry[];
  onDeleteSession: (sessionId: string) => void;
  onRestoreSession: (sessionId: string) => void;
}) {
  const [rows, setRows] = useState(initialRows);

  return (
    <ClosedSessionsTrigger
      closedChatTabs={rows}
      onRestoreSession={onRestoreSession}
      onDeleteSession={(sessionId) => {
        onDeleteSession(sessionId);
        setRows((current) => current.filter((row) => row.id !== sessionId));
      }}
    />
  );
}

function renderClosedSessions({
  initialRows = CLOSED_SESSIONS,
  onDeleteSession = vi.fn(),
  onRestoreSession = vi.fn(),
}: {
  initialRows?: HeaderChatMenuEntry[];
  onDeleteSession?: (sessionId: string) => void;
  onRestoreSession?: (sessionId: string) => void;
} = {}) {
  return render(
    <ClosedSessionsHarness
      initialRows={initialRows}
      onDeleteSession={onDeleteSession}
      onRestoreSession={onRestoreSession}
    />,
  );
}

function openClosedSessions(count: number) {
  fireEvent.click(screen.getByRole("button", { name: `Closed sessions (${count})` }));
  expect(screen.getByRole("button", { name: "Session one" })).toBeTruthy();
}

function closedSession(id: string, title: string): HeaderChatMenuEntry {
  return {
    id,
    title,
    agentKind: "claude",
    viewState: "idle",
    isResolvingSession: false,
    hasUnreadActivity: false,
    isActive: false,
    isVisible: false,
    closedAt: null,
  };
}
