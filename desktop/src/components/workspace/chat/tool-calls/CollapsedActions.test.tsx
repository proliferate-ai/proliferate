// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toolItem } from "@/lib/domain/chat/transcript/transcript-presentation-test-fixtures";
import { CollapsedActions, InlineToolActions } from "./CollapsedActions";

vi.mock("@/hooks/workspaces/files/use-file-reference-actions", () => ({
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

    expect(screen.queryByText("Reading read.ts")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Explored 1 file/i }));

    expect(screen.getByText("Reading read.ts")).toBeTruthy();
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
    expect(html).toContain("Edited");
    expect(html).not.toContain("max-h-80");
    expect(html).not.toContain("max-h-[7.5rem]");
    expect(html).not.toContain("overflow-y-auto overflow-x-hidden");
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
  });

  it("uses tight spacing for grouped inline edit actions", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "edit-1": toolItem("edit-1", "turn-1", 1, "file_change"),
      "edit-2": toolItem("edit-2", "turn-1", 2, "file_change"),
    };

    const html = renderToStaticMarkup(
      createElement(InlineToolActions, {
        itemIds: ["edit-1", "edit-2"],
        transcript,
      }),
    );

    expect(html).toContain("flex flex-col gap-0");
    expect(html).not.toContain("flex flex-col gap-1");
  });
});
