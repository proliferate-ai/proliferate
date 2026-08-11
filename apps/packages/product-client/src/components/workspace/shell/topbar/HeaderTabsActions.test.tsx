// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClosedSessionsTrigger } from "#product/components/workspace/shell/topbar/HeaderTabsActions";
import type {
  HeaderChatMenuEntry,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

const closedSession: HeaderChatMenuEntry = {
  id: "session-1",
  title: "Session one",
  agentKind: "claude",
  viewState: "idle",
  isResolvingSession: false,
  hasUnreadActivity: false,
  isActive: false,
  isVisible: false,
  closedAt: "2026-08-10T20:00:00.000Z",
};

describe("ClosedSessionsTrigger", () => {
  afterEach(cleanup);

  it("restores the selected session from its restore icon and closes the popover", async () => {
    const onRestoreSession = vi.fn();
    const onDeleteSession = vi.fn();

    render(
      <ClosedSessionsTrigger
        closedChatTabs={[closedSession]}
        onRestoreSession={onRestoreSession}
        onDeleteSession={onDeleteSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Closed sessions (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore Session one" }));

    expect(onRestoreSession).toHaveBeenCalledOnce();
    expect(onRestoreSession).toHaveBeenCalledWith("session-1");
    expect(onDeleteSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Restore Session one" })).toBeNull();
    });
  });
});
