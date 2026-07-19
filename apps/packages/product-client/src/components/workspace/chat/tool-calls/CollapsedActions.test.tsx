// @vitest-environment jsdom

import type { PropsWithChildren, ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
} from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import {
  parsedCommandItem,
  terminalItem,
  toolItem,
} from "@proliferate/product-domain/chats/transcript/transcript-presentation-test-fixtures";
import { CollapsedActions } from "#product/components/workspace/chat/tool-calls/CollapsedActions";

const webTestHost = { desktop: null } as ProductHost;

function WebProductHostWrapper({ children }: PropsWithChildren) {
  return <ProductHostProvider host={webTestHost}>{children}</ProductHostProvider>;
}

function render(ui: ReactElement) {
  return testingRender(ui, { wrapper: WebProductHostWrapper });
}

const { openPrimaryMock, fileReferenceActionsCalls } = vi.hoisted(() => ({
  openPrimaryMock: vi.fn(),
  fileReferenceActionsCalls: [] as Array<{ rawPath: string; workspacePath?: string | null }>,
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: (args: { rawPath: string; workspacePath?: string | null }) => {
    fileReferenceActionsCalls.push(args);
    return {
      reference: {
        rawPath: args.rawPath,
        path: args.rawPath,
        line: null,
        column: null,
        absolutePath: `/repo/${args.rawPath}`,
        workspacePath: args.rawPath,
      },
      openTargets: [],
      canOpenInSidebar: true,
      canOpenExternal: true,
      copyPath: vi.fn(),
      openInSidebar: vi.fn(),
      openDefault: vi.fn(),
      openPrimary: openPrimaryMock,
      openWithTarget: vi.fn(),
      reveal: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  openPrimaryMock.mockClear();
  fileReferenceActionsCalls.length = 0;
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
    expect(activeLabelClasses).toContain("!text-current");
    const iconShell = activeButton.querySelector("span[aria-hidden='true']");
    const summaryContent = iconShell?.parentElement;
    const activeSvgs = activeButton.querySelectorAll("svg");
    const disclosureChevron = activeSvgs[activeSvgs.length - 1];
    expect(activeButton.className).toContain("gap-1");
    expect(activeButton.className).toContain("leading-[1.5]");
    expect(activeButton.className).toContain("text-foreground/60");
    expect(summaryContent?.className).toContain("gap-1.5");
    expect(iconShell?.className).toContain("icon-paired");
    expect(iconShell?.className).toContain("[&_svg]:text-current");
    expect(disclosureChevron?.getAttribute("class")).toContain("icon-compact");
    expect(disclosureChevron?.getAttribute("class")).toContain("transition-transform");
    expect(disclosureChevron?.getAttribute("class")).toContain("duration-300");
    expect(disclosureChevron?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(disclosureChevron?.querySelector("path")?.getAttribute("d")).toContain("7.52925 3.7793");
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

    const completedButton = screen.getByRole("button", { name: /Read files/i });
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
    expect(screen.getByRole("button", { name: /Ran pnpm test/i })).toBeTruthy();
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

    const completedButton = screen.getByRole("button", { name: /Edited a file/i });
    expect(completedButton.getAttribute("data-active")).toBeNull();
    expect(completedButton.innerHTML).not.toContain("thinking-text");
    expect(completedButton.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 21");
    expect(completedButton.querySelector("path")?.getAttribute("d")).toContain("11.3312 4.20472");
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
    expect(liveButton.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(liveButton.querySelector("path")?.getAttribute("d")).toContain("7.33057 1.98535");
  });

  it("uses Codex's dominant completed icon instead of last-command priority", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, "pnpm test", "completed"),
      read: toolItem("read", "turn-1", 2, "file_read", "completed"),
      search: toolItem("search", "turn-1", 3, "search", "completed"),
    };

    render(
      <CollapsedActions
        itemIds={["command", "read", "search"]}
        transcript={transcript}
      />,
    );

    const button = screen.getByRole("button", { name: /Read files, ran a command/i });
    expect(button.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(button.querySelector("path")?.getAttribute("d")).toContain("7.33057 1.98535");
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
    fireEvent.click(screen.getByRole("button", { name: /Edited a file/i }));

    const html = document.body.innerHTML;
    expect(html).toContain("data-collapsed-actions-ledger");
    expect(html).toContain("Edit");
    expect(html).not.toContain("max-h-80");
    expect(html).not.toContain("max-h-[7.5rem]");
    expect(html).not.toContain("overflow-y-auto overflow-x-hidden");
    expect(html).not.toContain("pl-4");
    expect(html).toContain("flex flex-col gap-1");
  });

  it("starts expanded non-edit ledgers at the top with Codex edge fading", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Read files/i }));

    const html = document.body.innerHTML;
    expect(html).toContain("data-collapsed-actions-ledger");
    const ledger = document.querySelector("[data-collapsed-actions-ledger]");
    expect(ledger?.textContent).toContain("Read");
    expect(ledger?.querySelector("[data-file-reference-badge='inline']")?.textContent)
      .toContain("read.ts");
    expect(html).toContain("overflow-y-auto overflow-x-hidden");
    expect(html).toContain("vertical-scroll-fade-mask");
    expect(html).toContain("max-h-56");
    expect((ledger as HTMLElement).style.getPropertyValue("--edge-fade-distance")).toBe("3rem");
    expect(ledger?.scrollTop).toBe(0);
    expect(html).not.toContain("pl-4");
  });

  it("does not steal the user's ledger scroll position while work is live", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read", "completed"),
      command: terminalItem("command", "turn-1", 2, "pnpm test", "in_progress"),
    };

    const { rerender } = render(
      <CollapsedActions
        itemIds={["read", "command"]}
        transcript={transcript}
        autoFollow
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Running command/i }));

    const ledger = document.querySelector<HTMLElement>("[data-collapsed-actions-ledger]");
    expect(ledger?.getAttribute("data-live")).toBe("true");
    if (!ledger) throw new Error("Expected activity ledger");
    ledger.scrollTop = 24;

    transcript.itemsById.search = toolItem("search", "turn-1", 3, "search", "in_progress");
    rerender(
      <CollapsedActions
        itemIds={["read", "command", "search"]}
        transcript={transcript}
        autoFollow
      />,
    );

    expect(ledger.scrollTop).toBe(24);
  });

  it("uses the same Codex ink for command and plain ledger rows", () => {
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

    const commandRow = screen.getByRole("button", { name: /Ran pnpm test/i });
    const readRow = screen.getByText("Read").parentElement?.parentElement;
    expect(commandRow.className).toContain("text-foreground/60");
    expect(readRow?.className).toContain("text-foreground/60");
  });

  it("keeps grouped edit activity compact until a file row reveals its diff", () => {
    const transcript = createTranscriptState("session-1");
    const firstEdit = toolItem("edit-1", "turn-1", 1, "file_change");
    const firstEditPart = firstEdit.contentParts[0];
    if (firstEditPart?.type === "file_change") {
      firstEditPart.patch = "@@ -1 +1 @@\n-old\n+new";
      firstEditPart.additions = 1;
      firstEditPart.deletions = 1;
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
    fireEvent.click(screen.getByRole("button", { name: "Edited files" }));

    const ledger = document.querySelector("[data-collapsed-actions-ledger]");
    expect(ledger?.firstElementChild?.className).toContain("flex flex-col gap-1");
    expect(document.body.innerHTML).toContain("edit-1.ts");
    expect(document.body.innerHTML).not.toContain("data-diff-surface=\"chat\"");
    const editRow = ledger?.querySelector("[data-edit-action-row]");
    const editLabel = editRow?.querySelector("[data-edit-action-file-label]");
    expect(editRow?.textContent).not.toContain("Edit ");
    const editIcon = editRow?.querySelector("svg");
    expect(editIcon?.getAttribute("viewBox")).toBe("0 0 20 21");
    expect(editIcon?.querySelector("path")?.getAttribute("d")).toContain("11.3312 4.20472");
    expect(editIcon?.parentElement?.className).toContain("icon-paired");
    expect(editIcon?.parentElement?.className).toContain("text-current");
    expect(editRow?.className).toContain("text-foreground/60");
    expect(editLabel?.className).toContain("decoration-dotted");
    const stats = editRow?.querySelector("[data-thread-find-skip='true']");
    expect(stats?.textContent).toBe("+1-1");
    expect(stats?.querySelector("span")?.className).toContain("text-inherit");
    expect(stats?.querySelector("span")?.className).toContain("activity-file-change-stat-additions");

    const toggle = screen.getByRole("button", { name: "Toggle diff for edit-1.ts" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.innerHTML).toContain("data-diff-surface=\"chat\"");
  });

  it("opens Changes from an edit summary and keeps ledger disclosure separate", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "edit-1": toolItem("edit-1", "turn-1", 1, "file_change"),
      "edit-2": toolItem("edit-2", "turn-1", 2, "file_change"),
    };
    const onOpenChanges = vi.fn();

    render(
      <CollapsedActions
        itemIds={["edit-1", "edit-2"]}
        transcript={transcript}
        onOpenChanges={onOpenChanges}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edited files" }));
    expect(onOpenChanges).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-collapsed-actions-ledger]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand edited files" }));
    expect(document.querySelector("[data-collapsed-actions-ledger]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Collapse edited files" })).toBeTruthy();
  });

  it("repeats each parsed command's semantic icon in the expanded ledger", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      mixed: parsedCommandItem("mixed", "turn-1", 1, [
        { type: "search", cmd: "rg anchor", query: "anchor" },
        { type: "read", cmd: "cat README.md", path: "README.md", name: "README.md" },
        { type: "command", cmd: "pnpm test" },
      ], "completed"),
    };

    render(
      <CollapsedActions
        itemIds={["mixed"]}
        transcript={transcript}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read files, ran a command/i }));

    const searchRow = screen.getByText("Searched for anchor").parentElement;
    const readRow = screen.getByText("Read").parentElement?.parentElement;
    const commandRow = screen.getByText("Ran pnpm test").parentElement;
    expect(readRow?.querySelector("[data-file-reference-badge='inline']")?.textContent)
      .toContain("README.md");
    const searchIcon = searchRow?.querySelector("svg");
    const readIcon = readRow?.children[0]?.querySelector("svg");
    const commandIcon = commandRow?.querySelector("svg");

    expect(searchIcon?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(searchIcon?.querySelector("path")?.getAttribute("d")).toContain("7.33057 1.98535");
    expect(readIcon?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(readIcon?.querySelector("path")?.getAttribute("d")).toContain("16.3965 5.01128");
    expect(commandIcon?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(commandIcon?.querySelector("path")?.getAttribute("d")).toContain("6.19629 7.86231");
    for (const icon of [searchIcon, readIcon, commandIcon]) {
      expect(icon?.parentElement?.className).toContain("icon-paired");
      expect(icon?.parentElement?.className).toContain("text-current");
    }
  });

  it("repeats the shared generic action icon in the expanded ledger", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      generic: toolItem("generic", "turn-1", 1, "other", "completed"),
    };

    render(
      <CollapsedActions
        itemIds={["generic"]}
        transcript={transcript}
      />,
    );

    const header = screen.getByRole("button", { name: /Ran an action/i });
    const headerIcon = header.querySelector("svg");
    fireEvent.click(header);
    const ledger = document.querySelector("[data-collapsed-actions-ledger]");
    const detailIcon = ledger?.querySelector("svg");

    expect(detailIcon?.getAttribute("viewBox")).toBe(headerIcon?.getAttribute("viewBox"));
    expect(detailIcon?.querySelector("path")?.getAttribute("d"))
      .toBe(headerIcon?.querySelector("path")?.getAttribute("d"));
    const genericLabels = screen.getAllByText("Tool call");
    expect(genericLabels[genericLabels.length - 1]?.parentElement?.className)
      .toContain("text-foreground/60");
  });

  it("reveals the edited diff from the row and opens the file only from its arrow", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Edited a file/i }));
    const toggle = screen.getByRole("button", { name: "Toggle diff for edit-1.ts" });
    fireEvent.click(toggle);
    expect(document.body.innerHTML).toContain("data-diff-surface=\"chat\"");
    expect(openPrimaryMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open edit-1.ts" }));
    expect(openPrimaryMock).toHaveBeenCalledOnce();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
