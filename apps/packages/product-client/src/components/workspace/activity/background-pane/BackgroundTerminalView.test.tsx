/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import { BackgroundTerminalView } from "./BackgroundTerminalView";

let feedStreamState: { content: string; connected: boolean; error: string | null } = {
  content: "",
  connected: false,
  error: null,
};
const useFeedStreamMock = vi.fn(() => feedStreamState);

vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => "session-1",
}));
vi.mock("#product/stores/sessions/session-directory-store", () => ({
  useSessionDirectoryStore: () => "workspace-1",
}));
vi.mock("#product/hooks/activity/derived/use-feed-stream", () => ({
  useFeedStream: (...args: unknown[]) => useFeedStreamMock(...args),
}));

function makeProcess(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "npm run build",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-16T00:00:00Z",
    endedAt: null,
    feed: { feedId: "feed-1", kind: "terminal_bytes" },
    ...overrides,
  };
}

afterEach(() => {
  feedStreamState = { content: "", connected: false, error: null };
  useFeedStreamMock.mockClear();
  cleanup();
});

describe("BackgroundTerminalView", () => {
  it("renders the shell prompt line and the command exactly as run", () => {
    render(
      <BackgroundTerminalView process={makeProcess()} feed={makeProcess().feed} onBack={() => {}} />,
    );
    expect(screen.getByText("$")).toBeTruthy();
    expect(screen.getAllByText("npm run build").length).toBeGreaterThan(0);
  });

  it("renders the feed's streamed bytes", () => {
    feedStreamState = { content: "building…\ndone\n", connected: true, error: null };
    render(
      <BackgroundTerminalView process={makeProcess()} feed={makeProcess().feed} onBack={() => {}} />,
    );
    expect(screen.getByText(/building…/)).toBeTruthy();
  });

  it("renders the exact read-only footer copy", () => {
    render(
      <BackgroundTerminalView process={makeProcess()} feed={makeProcess().feed} onBack={() => {}} />,
    );
    expect(
      screen.getByText("Read-only mirror of the agent's own output. No input, no resize, no kill."),
    ).toBeTruthy();
  });

  it("has no input/textarea/select write affordance anywhere in the view", () => {
    const { container } = render(
      <BackgroundTerminalView process={makeProcess()} feed={makeProcess().feed} onBack={() => {}} />,
    );
    expect(container.querySelectorAll("input").length).toBe(0);
    expect(container.querySelectorAll("textarea").length).toBe(0);
    expect(container.querySelectorAll("select").length).toBe(0);
  });

  it("fires onBack when the back control is clicked", () => {
    const onBack = vi.fn();
    render(
      <BackgroundTerminalView process={makeProcess()} feed={makeProcess().feed} onBack={onBack} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to background work" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("enables the feed stream only when a feed ref is present", () => {
    render(
      <BackgroundTerminalView process={makeProcess()} feed={makeProcess().feed} onBack={() => {}} />,
    );
    expect(useFeedStreamMock).toHaveBeenCalledWith(
      { feedId: "feed-1", kind: "terminal_bytes" },
      { workspaceId: "workspace-1", enabled: true },
    );
  });

  it("disables the feed stream when there is no feed ref", () => {
    render(
      <BackgroundTerminalView process={makeProcess({ feed: null })} feed={null} onBack={() => {}} />,
    );
    expect(useFeedStreamMock).toHaveBeenCalledWith(
      null,
      { workspaceId: "workspace-1", enabled: false },
    );
  });
});
