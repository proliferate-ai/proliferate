// @vitest-environment jsdom
//
// bgwork r8 round 3: a background command run BY a native subagent itself
// renders inside that subagent's own nested transcript
// (`TranscriptAgentGroupBlock`'s `renderScopedWork` -> `ScopedTranscriptBlocks`)
// — the same collapsed-ledger shape fixed at the top level in round 2, one
// level down. `TranscriptAgentGroupBlock` already threads `onOpenSubagent`
// down this same path; `onOpenBackgroundTerminal` follows the identical
// prop-threading convention rather than a local hook call (see
// CollapsedCommandActionRow.background-terminal-clickin.test.tsx for why a
// local `useOpenBackgroundTerminalDetail()` call isn't safe here either).
//
// Split out of TranscriptAgentGroupBlock.test.tsx (PROD-SIZE-1 — pushed that
// file to 606 lines against the repo-wide 600-line cap); no assertions
// changed, only relocated to this sibling file with its own minimal imports.
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import type { ToolCallItem } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  toolItem,
} from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import {
  TranscriptAgentGroupBlock,
} from "#product/components/workspace/chat/transcript/TranscriptAgentGroupBlock";

// The collapsed-action disclosure (`AnimatedCollapsibleContent`) reveals its
// expanded subtree one `requestAnimationFrame` after the toggle commits, so
// the freshly mounted rows stay `inert`/`aria-hidden` until that frame runs.
// jsdom never advances a real frame between a synchronous `fireEvent.click`
// and the following query, so drive the frame inline — the same convention
// `CollapsedActions.test.tsx` uses.
beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function backgroundCommandChildItem(resultText: string): ToolCallItem {
  return {
    ...toolItem("child-bash", "turn-1", 2, "terminal", "in_progress"),
    rawInput: { command: "sleep 100 &" },
    contentParts: [
      { type: "terminal_output", terminalId: "child-bash", event: "output", data: resultText },
    ],
  };
}

describe("TranscriptAgentGroupBlock onOpenBackgroundTerminal (nested background command click-in)", () => {
  it("threads onOpenBackgroundTerminal down to a background command nested in the subagent's own transcript", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("native-task", "turn-1", 1, "subagent", "completed"),
      title: "Inspect the repository",
      nativeToolName: "Task",
      rawInput: { prompt: "Inspect the transcript pipeline" },
    };
    const childItem = backgroundCommandChildItem("Command running in background with ID: bn30h453a");
    transcript.itemsById[item.itemId] = item;
    transcript.itemsById[childItem.itemId] = childItem;
    const onOpenBackgroundTerminal = vi.fn();

    const { getByText, getByRole } = render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [childItem.itemId],
        transcript,
        childrenByParentId: new Map([[item.itemId, [childItem.itemId]]]),
        renderChild: () => null,
        onOpenBackgroundTerminal,
      }),
    );

    // No onOpenSubagent wired: the header itself is the expand/collapse
    // toggle for this block's own body.
    fireEvent.click(getByText("Subagent created"));
    // Reveal the nested work ledger.
    fireEvent.click(getByText("1 tool call"));
    // Expand the collapsed-ledger toggle to reach the inner command row.
    fireEvent.click(getByRole("button", { name: /Running command/i }));
    const row = getByRole("button", { name: /sleep 100 &/ });

    fireEvent.click(row);

    expect(onOpenBackgroundTerminal).toHaveBeenCalledWith("bn30h453a");
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("negative control: without onOpenBackgroundTerminal, the nested row keeps the ordinary inline disclosure", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("native-task-unwired", "turn-1", 1, "subagent", "completed"),
      title: "Inspect the repository",
      nativeToolName: "Task",
      rawInput: { prompt: "Inspect the transcript pipeline" },
    };
    const childItem = backgroundCommandChildItem("Command running in background with ID: bn30h453a");
    transcript.itemsById[item.itemId] = item;
    transcript.itemsById[childItem.itemId] = childItem;

    const { getByText, getByRole } = render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [childItem.itemId],
        transcript,
        childrenByParentId: new Map([[item.itemId, [childItem.itemId]]]),
        renderChild: () => null,
      }),
    );

    fireEvent.click(getByText("Subagent created"));
    fireEvent.click(getByText("1 tool call"));
    fireEvent.click(getByRole("button", { name: /Running command/i }));
    const row = getByRole("button", { name: /sleep 100 &/ });

    fireEvent.click(row);

    // Falls back to the ordinary inline toggle rather than no-op'ing.
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(getByText(/Command running in background with ID/)).not.toBeNull();
  });
});
