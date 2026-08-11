// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  closedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

describe("ClosedSessionsTrigger row hit target", () => {
  afterEach(cleanup);

  it("restores exactly once from the title, row background, and timestamp", async () => {
    const user = userEvent.setup();
    const onRestoreSession = vi.fn();
    const onDeleteSession = vi.fn();

    render(
      <ClosedSessionsTrigger
        closedChatTabs={[closedSession]}
        onRestoreSession={onRestoreSession}
        onDeleteSession={onDeleteSession}
      />,
    );

    await openClosedSessions(user);
    await user.click(screen.getByRole("button", { name: "Session one" }));
    expect(onRestoreSession).toHaveBeenCalledTimes(1);
    expect(onRestoreSession).toHaveBeenLastCalledWith("session-1");
    expect(onDeleteSession).not.toHaveBeenCalled();
    await expectClosedSessionsToClose();

    await openClosedSessions(user);
    const row = screen.getByText("Session one").closest("[data-telemetry-mask='true']");
    expect(row).not.toBeNull();
    await user.click(row!);
    expect(onRestoreSession).toHaveBeenCalledTimes(2);
    expect(onRestoreSession).toHaveBeenLastCalledWith("session-1");
    expect(onDeleteSession).not.toHaveBeenCalled();
    await expectClosedSessionsToClose();

    await openClosedSessions(user);
    await user.click(screen.getByText("1h ago"));
    expect(onRestoreSession).toHaveBeenCalledTimes(3);
    expect(onRestoreSession).toHaveBeenLastCalledWith("session-1");
    expect(onDeleteSession).not.toHaveBeenCalled();
    await expectClosedSessionsToClose();
  });

  it("keeps Delete isolated from the row restore action", async () => {
    const user = userEvent.setup();
    const onRestoreSession = vi.fn();
    const onDeleteSession = vi.fn();

    render(
      <ClosedSessionsTrigger
        closedChatTabs={[closedSession]}
        onRestoreSession={onRestoreSession}
        onDeleteSession={onDeleteSession}
      />,
    );

    await openClosedSessions(user);
    await user.click(screen.getByRole("button", { name: "Delete Session one" }));

    expect(onDeleteSession).toHaveBeenCalledOnce();
    expect(onDeleteSession).toHaveBeenCalledWith("session-1");
    expect(onRestoreSession).not.toHaveBeenCalled();
    await expectClosedSessionsToClose();
  });

  it("retains native keyboard restore behavior on the title button", async () => {
    const user = userEvent.setup();
    const onRestoreSession = vi.fn();
    const onDeleteSession = vi.fn();

    render(
      <ClosedSessionsTrigger
        closedChatTabs={[closedSession]}
        onRestoreSession={onRestoreSession}
        onDeleteSession={onDeleteSession}
      />,
    );

    await openClosedSessions(user);
    screen.getByRole("button", { name: "Session one" }).focus();
    await user.keyboard("{Enter}");

    expect(onRestoreSession).toHaveBeenCalledOnce();
    expect(onRestoreSession).toHaveBeenCalledWith("session-1");
    expect(onDeleteSession).not.toHaveBeenCalled();
    await expectClosedSessionsToClose();
  });
});

async function openClosedSessions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Closed sessions (1)" }));
  await screen.findByText("Session one");
}

async function expectClosedSessionsToClose() {
  await waitFor(() => {
    expect(screen.queryByText("Session one")).toBeNull();
  });
}
