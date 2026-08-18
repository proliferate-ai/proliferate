// @vitest-environment jsdom
//
// bgwork r8 round 2: a background command's row inside a COLLAPSED action
// ledger (the "Worked for Ns" group every completed turn settles into) must
// open the Background work pane's terminal detail on click, exactly like the
// top-level TranscriptToolCallItemBlock path already does (round 1). This is
// the path the founder actually sees once a turn finishes, since every turn
// collapses on completion — round 1 only covered the still-expanded, live
// path.
//
// `onOpenBackgroundTerminal` is a threaded prop here (not a local
// `useOpenBackgroundTerminalDetail()` call): that hook reaches into
// `useWorkspaces()`/`useProductAuthUserId()`, which requires a fully equipped
// `ProductHostProvider`. `CollapsedActions` is mounted by many other tests
// with a minimal test host, so the callback is supplied by the caller
// (ultimately `MessageList`, same as the round-1 top-level path) and reaches
// `CommandActionRow` through `CollapsedActions` -> `CollapsedActionRows`.
import type { PropsWithChildren, ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
} from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import { TranscriptContextProviders } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { CollapsedActions } from "#product/components/workspace/chat/tool-calls/CollapsedActions";

const webTestHost = { desktop: null } as ProductHost;

function Wrapper({ children }: PropsWithChildren) {
  return (
    <ProductHostProvider host={webTestHost}>
      <TranscriptContextProviders sessionId="session-1">
        {children}
      </TranscriptContextProviders>
    </ProductHostProvider>
  );
}

function render(ui: ReactElement) {
  return testingRender(ui, { wrapper: Wrapper });
}

const mocks = vi.hoisted(() => ({
  sessionProcesses: [] as ActivityProcessWire[],
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
    status: "in_progress",
    rawInput: { command: "for i in $(seq 1 15); do echo $i; sleep 1; done" },
    contentParts: [
      { type: "tool_result_text", text: resultText },
    ],
  });
}

function rosterProcess(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
  return {
    id: "bn30h453a",
    command: "for i in $(seq 1 15); do echo $i; sleep 1; done",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-17T10:00:00.000Z",
    endedAt: null,
    feed: null,
    ...overrides,
  };
}

/**
 * The ledger's outer "Worked for Ns" toggle summarizes the live action with
 * the generic "Running command" label, while the inner `CommandActionRow`
 * names itself after the actual shell text ("Running: for i in ..."). Expand
 * the outer toggle (matched by the generic label), then look up the inner
 * row by its command-specific label.
 */
function expandLedgerAndGetInnerRow(innerName: RegExp): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: /Running command/i }));
  return screen.getByRole("button", { name: innerName });
}

describe("CollapsedActionRows / CommandActionRow — background command click-in (bgwork r8 round 2)", () => {
  beforeEach(() => {
    mocks.sessionProcesses = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens the background terminal detail on click instead of toggling the collapsed disclosure", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: backgroundedBashItem("Command running in background with ID: bn30h453a"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    const row = expandLedgerAndGetInnerRow(/Running: for i in/i);

    fireEvent.click(row);

    expect(onOpenBackgroundTerminal).toHaveBeenCalledWith("bn30h453a");
    // Never reveals the inline Shell output panel for a background row.
    expect(screen.queryByText("Shell")).toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the roster's trailing status text when roster data is present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T10:04:12.000Z"));
    mocks.sessionProcesses = [rosterProcess({ startedAt: "2026-08-17T10:00:00.000Z" })];
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: backgroundedBashItem("Command running in background with ID: bn30h453a"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={vi.fn()}
      />,
    );
    expandLedgerAndGetInnerRow(/Running: for i in/i);

    expect(screen.getByText("running · 4m 12s")).toBeTruthy();
  });

  it("still renders and opens the terminal when roster data is absent, with an empty trailing slot", () => {
    const onOpenBackgroundTerminal = vi.fn();
    mocks.sessionProcesses = []; // e.g. after reload — fold state doesn't survive.
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: backgroundedBashItem("Command running in background with ID: bn30h453a"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    const row = expandLedgerAndGetInnerRow(/Running: for i in/i);
    expect(row.textContent).not.toMatch(/running ·|exited/);

    fireEvent.click(row);
    expect(onOpenBackgroundTerminal).toHaveBeenCalledWith("bn30h453a");
  });

  it("negative control: an unwired caller (no onOpenBackgroundTerminal prop) keeps the ordinary inline disclosure", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: backgroundedBashItem("Command running in background with ID: bn30h453a"),
    };

    // No onOpenBackgroundTerminal passed at all — mirrors a caller (e.g. the
    // read-only playground transcript) that hasn't wired the pane opener.
    render(<CollapsedActions itemIds={["cmd"]} transcript={transcript} />);
    const row = expandLedgerAndGetInnerRow(/Running: for i in/i);

    fireEvent.click(row);

    // Falls back to the ordinary inline toggle rather than throwing or no-op'ing silently.
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Command running in background with ID/)).toBeTruthy();
  });

  it("negative control: a foreground command keeps byte-identical inline disclosure behavior", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: backgroundedBashItem("total 0\ndrwxr-xr-x  2 pablo  staff  64 file.txt"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    const row = expandLedgerAndGetInnerRow(/Running: for i in/i);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/drwxr-xr-x/)).toBeNull();

    fireEvent.click(row);

    expect(onOpenBackgroundTerminal).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/drwxr-xr-x/)).toBeTruthy();
  });

  it("negative control: a near-miss sentence that doesn't parse an id keeps disclosure toggling", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: backgroundedBashItem("The command is now running in the background, ID: bn30h453a"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    const row = expandLedgerAndGetInnerRow(/Running: for i in/i);
    fireEvent.click(row);

    expect(onOpenBackgroundTerminal).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/The command is now running/)).toBeTruthy();
  });
});
