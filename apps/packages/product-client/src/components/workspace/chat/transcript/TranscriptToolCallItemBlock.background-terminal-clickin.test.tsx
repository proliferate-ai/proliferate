// @vitest-environment jsdom
//
// bgwork r8: clicking a BACKGROUND command's tool-call row opens the
// Background work pane's terminal detail (mirrors the subagent-creation
// click-in) instead of toggling the row's inline output disclosure. The
// correlation is entirely client-side: the Bash tool's own result text
// carries "Command running in background with ID: {taskId}", and that id is
// looked up against the session's roster (`ActivityProcessWire[]`) purely for
// the trailing status text — click-in only needs the id to parse.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import { TranscriptToolCallItemBlock } from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock";
import { renderWithProductHost as render } from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock.test-fixtures";

const mocks = vi.hoisted(() => ({
  sessionProcesses: [] as ActivityProcessWire[],
}));

vi.mock("#product/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: vi.fn() }),
}));

vi.mock("#product/hooks/activity/derived/use-session-activity", () => ({
  useSessionActivityForSession: () => ({
    loops: [],
    loopCapabilities: { supported: false, native: false },
    processes: mocks.sessionProcesses,
    agents: [],
  }),
}));

function backgroundedBashItem(resultText: string) {
  return toolCallItem({
    nativeToolName: "Bash",
    toolKind: "execute",
    rawInput: { command: "while :; do gate-status; sleep 90; done" },
    contentParts: [
      { type: "tool_result_text", text: resultText },
    ],
  });
}

function rosterProcess(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
  return {
    id: "proc-999",
    command: "while :; do gate-status; sleep 90; done",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-17T10:00:00.000Z",
    endedAt: null,
    feed: null,
    ...overrides,
  };
}

describe("TranscriptToolCallItemBlock — background command click-in (bgwork r8)", () => {
  beforeEach(() => {
    mocks.sessionProcesses = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens the background terminal detail on click instead of toggling disclosure", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const item = backgroundedBashItem("Command running in background with ID: proc-999");

    render(
      <TranscriptToolCallItemBlock
        item={item}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );

    const row = screen.getByRole("button", { name: /Running command/i });
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(row);

    expect(onOpenBackgroundTerminal).toHaveBeenCalledWith("proc-999");
    // Clicking never reveals the inline output panel for a background row.
    expect(screen.queryByText(/Command running in background with ID/)).toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the roster's trailing status text when roster data is present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T10:04:12.000Z"));
    mocks.sessionProcesses = [rosterProcess({ startedAt: "2026-08-17T10:00:00.000Z" })];
    const item = backgroundedBashItem("Command running in background with ID: proc-999");

    render(
      <TranscriptToolCallItemBlock
        item={item}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
        onOpenBackgroundTerminal={vi.fn()}
      />,
    );

    expect(screen.getByText("running · 4m 12s")).toBeTruthy();
  });

  it("still renders and opens the terminal when roster data is absent, with an empty trailing slot", () => {
    const onOpenBackgroundTerminal = vi.fn();
    mocks.sessionProcesses = []; // e.g. after reload — fold state doesn't survive.
    const item = backgroundedBashItem("Command running in background with ID: proc-999");

    render(
      <TranscriptToolCallItemBlock
        item={item}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );

    const row = screen.getByRole("button", { name: /Running command/i });
    expect(row.textContent).not.toMatch(/running ·|exited/);

    fireEvent.click(row);
    expect(onOpenBackgroundTerminal).toHaveBeenCalledWith("proc-999");
  });

  it("negative control: a foreground command keeps byte-identical inline disclosure behavior", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const item = backgroundedBashItem("total 0\ndrwxr-xr-x  2 pablo  staff  64 file.txt");

    render(
      <TranscriptToolCallItemBlock
        item={item}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );

    const row = screen.getByRole("button", { name: /Running command/i });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/drwxr-xr-x/)).toBeNull();

    fireEvent.click(row);

    // Toggles the ordinary inline disclosure — never routes to the pane.
    expect(onOpenBackgroundTerminal).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/drwxr-xr-x/)).toBeTruthy();
  });

  it("negative control: a near-miss sentence that doesn't parse an id keeps disclosure toggling", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const item = backgroundedBashItem("The command is now running in the background, ID: proc-999");

    render(
      <TranscriptToolCallItemBlock
        item={item}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );

    const row = screen.getByRole("button", { name: /Running command/i });
    fireEvent.click(row);

    expect(onOpenBackgroundTerminal).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/The command is now running/)).toBeTruthy();
  });
});
