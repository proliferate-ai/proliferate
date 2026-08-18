// @vitest-environment jsdom
//
// bgwork r8 round 3: live verification found round 2's fix only covered the
// `classifyCollapsedAction` "command" branch (`CommandActionRow`).
// `CollapsedActionRows`' FIRST branch checks `getToolCallParsedCommands`
// before that switch ever runs — any tool call whose harness supplies a
// `parsed_cmd` breakdown (including the founder's own
// `for i in $(seq 1 15); do echo probe $i; sleep 1; done`) takes the
// `ParsedCommandRows` branch instead and never reached round 2's fix.
//
// A background command is still ONE process with ONE result text no matter
// how many structural rows its parsed breakdown renders into, so the id is
// resolved once for the whole tool call and EVERY parsed row opens the same
// terminal detail — never a mix of some rows wired and others not.
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

const FOR_LOOP_COMMAND = "for i in $(seq 1 15); do echo probe $i; sleep 1; done";

/** The command carries regex metacharacters ($, (, )) — escape before using
 * it as a `getByRole` name matcher. */
function commandNameMatcher(command: string): RegExp {
  return new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** A tool call whose harness supplies a structured `parsed_cmd` breakdown —
 * the shape that takes `CollapsedActionRows`' `ParsedCommandRows` branch
 * instead of the `classifyCollapsedAction` "command" switch case. */
function parsedCommandBashItem(
  resultText: string,
  parsedCommands: Array<{ type: string; cmd: string }> = [{ type: "unknown", cmd: FOR_LOOP_COMMAND }],
) {
  return toolCallItem({
    nativeToolName: "Bash",
    toolKind: "execute",
    status: "in_progress",
    rawInput: {
      command: ["/bin/zsh", "-lc", FOR_LOOP_COMMAND],
      parsed_cmd: parsedCommands,
    },
    contentParts: [
      { type: "tool_result_text", text: resultText },
    ],
  });
}

function rosterProcess(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
  return {
    id: "bn30h453a",
    command: FOR_LOOP_COMMAND,
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-17T10:00:00.000Z",
    endedAt: null,
    feed: null,
    ...overrides,
  };
}

function expandLedger() {
  fireEvent.click(screen.getByRole("button", { name: /Running command/i }));
}

describe("CollapsedActionRows — parsed/compound background command click-in (bgwork r8 round 3)", () => {
  beforeEach(() => {
    mocks.sessionProcesses = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("takes the ParsedCommandRows branch for a harness-supplied parsed_cmd breakdown (confirms the reproduction)", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: parsedCommandBashItem("Command running in background with ID: bn30h453a"),
    };

    // No onOpenBackgroundTerminal wired here — this test only confirms the
    // fixture takes CollapsedActionRows' ParsedCommandRows branch (the
    // founder's own command text renders as the row's label), which is the
    // row CommandActionRow (round 2) never reaches. Click-in itself is
    // asserted by the next test.
    render(<CollapsedActions itemIds={["cmd"]} transcript={transcript} />);
    expandLedger();

    expect(screen.getByText(commandNameMatcher(FOR_LOOP_COMMAND))).toBeTruthy();
  });

  it("opens the background terminal detail on click for the founder's for-loop shape", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: parsedCommandBashItem("Command running in background with ID: bn30h453a"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    expandLedger();
    const row = screen.getByRole("button", { name: commandNameMatcher(FOR_LOOP_COMMAND) });

    fireEvent.click(row);

    expect(onOpenBackgroundTerminal).toHaveBeenCalledWith("bn30h453a");
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the roster's trailing status text on the parsed row when roster data is present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T10:04:12.000Z"));
    mocks.sessionProcesses = [rosterProcess({ startedAt: "2026-08-17T10:00:00.000Z" })];
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: parsedCommandBashItem("Command running in background with ID: bn30h453a"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={vi.fn()}
      />,
    );
    expandLedger();

    expect(screen.getByText("running · 4m 12s")).toBeTruthy();
  });

  it("every parsed row of a multi-command background call opens the same terminal detail — no half-wired subset", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: parsedCommandBashItem(
        "Command running in background with ID: bn30h453a",
        [
          { type: "unknown", cmd: "mkdir -p /tmp/probe" },
          { type: "unknown", cmd: FOR_LOOP_COMMAND },
        ],
      ),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    expandLedger();

    const firstRow = screen.getByRole("button", { name: /mkdir -p \/tmp\/probe/ });
    const secondRow = screen.getByRole("button", { name: commandNameMatcher(FOR_LOOP_COMMAND) });

    fireEvent.click(firstRow);
    fireEvent.click(secondRow);

    // Same process id from both rows — the whole tool call is one process.
    expect(onOpenBackgroundTerminal).toHaveBeenNthCalledWith(1, "bn30h453a");
    expect(onOpenBackgroundTerminal).toHaveBeenNthCalledWith(2, "bn30h453a");
    expect(onOpenBackgroundTerminal).toHaveBeenCalledTimes(2);
  });

  it("negative control: an unwired caller (no onOpenBackgroundTerminal prop) keeps the ordinary per-kind rendering", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: parsedCommandBashItem("Command running in background with ID: bn30h453a"),
    };

    // No onOpenBackgroundTerminal passed — mirrors a caller that hasn't wired
    // the pane opener (e.g. the read-only playground transcript).
    render(<CollapsedActions itemIds={["cmd"]} transcript={transcript} />);
    expandLedger();

    // Falls back to the ordinary, non-interactive PlainActionRow — no button
    // role at all for this row (that's the "ordinary per-kind rendering").
    expect(screen.queryByRole("button", { name: commandNameMatcher(FOR_LOOP_COMMAND) })).toBeNull();
    expect(screen.getByText(commandNameMatcher(FOR_LOOP_COMMAND))).toBeTruthy();
  });

  it("negative control: a foreground compound command keeps byte-identical per-kind rendering", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: parsedCommandBashItem(
        "probe 1\nprobe 2\nprobe 3",
        [{ type: "unknown", cmd: FOR_LOOP_COMMAND }],
      ),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    expandLedger();

    // Never became a clickable, terminal-opening row.
    expect(screen.queryByRole("button", { name: commandNameMatcher(FOR_LOOP_COMMAND) })).toBeNull();
    const label = screen.getByText(commandNameMatcher(FOR_LOOP_COMMAND));
    expect(label).toBeTruthy();

    fireEvent.click(label);
    expect(onOpenBackgroundTerminal).not.toHaveBeenCalled();
  });

  it("negative control: a near-miss sentence that doesn't parse an id keeps ordinary per-kind rendering", () => {
    const onOpenBackgroundTerminal = vi.fn();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      cmd: parsedCommandBashItem("The command is now running in the background, ID: bn30h453a"),
    };

    render(
      <CollapsedActions
        itemIds={["cmd"]}
        transcript={transcript}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      />,
    );
    expandLedger();

    expect(screen.queryByRole("button", { name: commandNameMatcher(FOR_LOOP_COMMAND) })).toBeNull();
    expect(onOpenBackgroundTerminal).not.toHaveBeenCalled();
  });
});
