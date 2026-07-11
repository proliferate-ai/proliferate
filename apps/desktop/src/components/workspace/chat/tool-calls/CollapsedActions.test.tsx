// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  terminalItem,
  toolItem,
} from "@proliferate/product-domain/chats/transcript/transcript-presentation-test-fixtures";
import { CollapsedActions } from "./CollapsedActions";

vi.mock("@/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: ({ rawPath }: { rawPath: string }) => ({
    reference: {
      rawPath,
      path: rawPath,
      line: null,
      column: null,
      absolutePath: `/repo/${rawPath}`,
      workspacePath: rawPath,
    },
    openTargets: [],
    canOpenInSidebar: true,
    canOpenExternal: true,
    copyPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: vi.fn(),
    openPrimary: vi.fn(),
    openWithTarget: vi.fn(),
    reveal: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

describe("CollapsedActions", () => {

  it("keeps the action ledger hidden until the summary row is clicked", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read", "in_progress"),
    };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
        autoFollow
      />,
    );

    expect(document.querySelector("[data-collapsed-actions-ledger]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Reading read\.ts/i }));

    expect(document.querySelector("[data-collapsed-actions-ledger]")).not.toBeNull();
    expect(screen.getAllByText("Reading read.ts").length).toBeGreaterThan(0);
  });

  it("marks active action batches with the live row affordance", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read", "in_progress"),
    };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
      />,
    );

    const activeButton = screen.getByRole("button", { name: /Reading read\.ts/i });
    expect(activeButton.getAttribute("data-active")).toBe("true");
    expect(activeButton.innerHTML).toContain("thinking-text");
    expect(activeButton.innerHTML).toContain("data-text=\"Reading read.ts\"");
    expect(activeButton.innerHTML).not.toContain("motion-safe:animate-pulse");
    const activeLabel = activeButton.querySelector("[data-thinking-text]");
    const activeLabelClasses = activeLabel?.className.split(/\s+/) ?? [];
    expect(activeLabelClasses).toContain("block");
    expect(activeLabelClasses).toContain("leading-[inherit]");
    const iconShell = activeButton.querySelector("span[aria-hidden='true']");
    const activeSvgs = activeButton.querySelectorAll("svg");
    const disclosureChevron = activeSvgs[activeSvgs.length - 1];
    expect(iconShell?.className).toContain("size-3.5");
    expect(iconShell?.className).toContain("[&_svg]:text-current");
    expect(disclosureChevron?.getAttribute("class")).toContain("size-3");
    expect(disclosureChevron?.getAttribute("class")).toContain("opacity-0");
    expect(disclosureChevron?.getAttribute("class")).toContain("group-hover/collapsed-actions:opacity-100");

    cleanup();

    transcript.itemsById.read = toolItem("read", "turn-1", 1, "file_read", "completed");
    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
      />,
    );

    const completedButton = screen.getByRole("button", { name: /Explored 1 file/i });
    expect(completedButton.getAttribute("data-active")).toBeNull();
    expect(completedButton.innerHTML).not.toContain("thinking-text");
    expect(completedButton.innerHTML).not.toContain("motion-safe:animate-pulse");
  });

  it("uses the current action label and icon while keeping prior work in the ledger", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, "pnpm test", "completed"),
      read: toolItem("read", "turn-1", 2, "file_read", "in_progress"),
    };

    render(
      <CollapsedActions
        itemIds={["command", "read"]}
        transcript={transcript}
      />,
    );

    const button = screen.getByRole("button", { name: /Reading read\.ts/i });
    expect(button.textContent).not.toContain("commands");
    expect(button.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(button.querySelector("path")?.getAttribute("d")).toContain("16.3965 5.01128");

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: /Running: pnpm test/i })).toBeTruthy();
    expect(screen.getAllByText("Reading read.ts").length).toBeGreaterThan(0);
  });

  it("does not revive a completed trailing action from the auto-follow hint", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      edit: toolItem("edit", "turn-1", 1, "file_change", "completed"),
    };

    render(
      <CollapsedActions
        itemIds={["edit"]}
        transcript={transcript}
        autoFollow
      />,
    );

    const completedButton = screen.getByRole("button", { name: /Edited 1 file/i });
    expect(completedButton.getAttribute("data-active")).toBeNull();
    expect(completedButton.innerHTML).not.toContain("thinking-text");
  });

  it("keeps a completed trailing exploration phase live until another block takes over", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      search: toolItem("search", "turn-1", 1, "search", "completed"),
    };

    render(
      <CollapsedActions
        itemIds={["search"]}
        transcript={transcript}
        liveContinuation
      />,
    );

    const liveButton = screen.getByRole("button", { name: /Searching files/i });
    expect(liveButton.getAttribute("data-active")).toBe("true");
    expect(liveButton.querySelector("[data-thinking-text]")).not.toBeNull();
  });

  it("preserves the same thinking node across a completed-search gap and appended search", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "search-1": toolItem("search-1", "turn-1", 1, "search", "in_progress"),
    };

    const { rerender } = render(
      <CollapsedActions
        itemIds={["search-1"]}
        transcript={transcript}
        liveContinuation
      />,
    );
    const originalThinkingNode = document.querySelector("[data-thinking-text]");

    transcript.itemsById["search-1"] = toolItem(
      "search-1",
      "turn-1",
      1,
      "search",
      "completed",
    );
    rerender(
      <CollapsedActions
        itemIds={["search-1"]}
        transcript={transcript}
        liveContinuation
      />,
    );
    expect(document.querySelector("[data-thinking-text]")).toBe(originalThinkingNode);

    transcript.itemsById["search-2"] = toolItem(
      "search-2",
      "turn-1",
      2,
      "search",
      "in_progress",
    );
    rerender(
      <CollapsedActions
        itemIds={["search-1", "search-2"]}
        transcript={transcript}
        liveContinuation
      />,
    );
    expect(document.querySelector("[data-thinking-text]")).toBe(originalThinkingNode);
  });

  it("animates live command counts with the thinking text treatment", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, "pnpm test", "in_progress"),
    };

    render(
      <CollapsedActions
        itemIds={["command"]}
        transcript={transcript}
      />,
    );

    const liveButton = screen.getByRole("button", { name: /Running command/i });
    expect(liveButton.getAttribute("data-active")).toBe("true");
    expect(liveButton.innerHTML).toContain("thinking-text");
    expect(liveButton.innerHTML).toContain("data-text=\"Running command\"");
  });

  it("does not cap the expanded ledger when it contains edits", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      edit: toolItem("edit", "turn-1", 1, "file_change"),
    };

    render(
      <CollapsedActions
        itemIds={["edit"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edited 1 file/i }));

    const html = document.body.innerHTML;
    expect(html).toContain("data-collapsed-actions-ledger");
    expect(html).toContain("Edit");
    expect(html).not.toContain("max-h-80");
    expect(html).not.toContain("max-h-[7.5rem]");
    expect(html).not.toContain("overflow-y-auto overflow-x-hidden");
    expect(html).not.toContain("pl-4");
    expect(html).toContain("flex flex-col gap-0");
  });

  it("keeps compact scrolling for expanded non-edit action ledgers", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read"),
    };

    render(
      <CollapsedActions
        itemIds={["read"]}
        transcript={transcript}
        autoFollow
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Explored 1 file/i }));

    const html = document.body.innerHTML;
    expect(html).toContain("data-collapsed-actions-ledger");
    expect(html).toContain("Read read.ts");
    expect(html).toContain("overflow-y-auto overflow-x-hidden");
    expect(html).toContain("max-h-[7.5rem]");
    expect(html).not.toContain("pl-4");
  });

  it("renders dropdownable command rows brighter than plain ledger rows", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read"),
      command: terminalItem("command", "turn-1", 2, "pnpm test"),
    };

    render(
      <CollapsedActions
        itemIds={["read", "command"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /command/i }));

    const commandRow = screen.getByRole("button", { name: /Running: pnpm test/i });
    const readRow = screen.getByText("Read read.ts");
    expect(commandRow.className).toContain("text-muted-foreground");
    expect(readRow.className).toContain("text-muted-foreground");
  });

  it("starts grouped edit cards closed inside the expanded action batch", () => {
    const transcript = createTranscriptState("session-1");
    const firstEdit = toolItem("edit-1", "turn-1", 1, "file_change");
    const firstEditPart = firstEdit.contentParts[0];
    if (firstEditPart?.type === "file_change") {
      firstEditPart.patch = "@@ -1 +1 @@\n-old\n+new";
    }
    transcript.itemsById = {
      "edit-1": firstEdit,
      "edit-2": toolItem("edit-2", "turn-1", 2, "file_change"),
    };

    render(
      <CollapsedActions
        itemIds={["edit-1", "edit-2"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edited 2 files/i }));

    const html = document.body.innerHTML;
    const ledger = document.querySelector("[data-collapsed-actions-ledger]");
    expect(ledger?.firstElementChild?.className).toContain("flex flex-col gap-0");
    expect(html).toContain("Edit");
    expect(html).toContain("edit-1.ts");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("data-diff-surface=\"chat\"");
    expect(html).not.toContain("Toggle file diff");
    expect(html).not.toContain("data-app-action-review-file-toggle");
    expect(html).not.toContain("aria-label=\"Open edit-1.ts\"");
  });

  it("opens grouped edit cards from the edit action row", () => {
    const transcript = createTranscriptState("session-1");
    const firstEdit = toolItem("edit-1", "turn-1", 1, "file_change");
    const firstEditPart = firstEdit.contentParts[0];
    if (firstEditPart?.type === "file_change") {
      firstEditPart.patch = "@@ -1 +1 @@\n-old\n+new";
    }
    transcript.itemsById = {
      "edit-1": firstEdit,
    };

    render(
      <CollapsedActions
        itemIds={["edit-1"]}
        transcript={transcript}
      />,
    );

    expect(document.body.innerHTML).not.toContain("data-diff-surface=\"chat\"");
    fireEvent.click(screen.getByRole("button", { name: /Edited 1 file/i }));
    fireEvent.click(screen.getByRole("button", { name: /Edit edit-1\.ts/i }));
    expect(document.body.innerHTML).toContain("data-diff-surface=\"chat\"");
  });
});
