// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerFileMentionSearch } from "#product/components/workspace/chat/input/ComposerFileMentionSearch";
import type { ChatMentionMenuItem } from "#product/lib/domain/chat/composer/chat-mention-items";

afterEach(cleanup);

function fileItem(index: number): ChatMentionMenuItem {
  return {
    kind: "file",
    file: {
      path: `src/file-${index}.ts`,
      name: `file-${index}.ts`,
      parent: "src",
    },
  };
}

function docItem(docId: string, filename: string, runLabel: string | null): ChatMentionMenuItem {
  return {
    kind: "contextDoc",
    doc: { docId, runId: "run-a", slug: filename.replace(/\.md$/, ""), filename, runLabel },
  };
}

function renderSearch(items: ChatMentionMenuItem[], onSelect = vi.fn()) {
  return render(
    <ComposerFileMentionSearch
      items={items}
      highlightedIndex={0}
      listRef={createRef<HTMLDivElement>()}
      query="file"
      isLoading={false}
      isError={false}
      isPending={false}
      runtimeReady
      onSelect={onSelect}
      onRowMouseEnter={vi.fn()}
      setRowRef={vi.fn()}
      getRowId={(index) => `file-result-${index}`}
    />,
  );
}

describe("ComposerFileMentionSearch", () => {
  it("renders long result sets inside the shared scrolling listbox", () => {
    renderSearch(Array.from({ length: 14 }, (_, index) => fileItem(index)));

    const listbox = screen.getByRole("listbox", { name: "File mentions" });
    expect(screen.getAllByRole("option")).toHaveLength(14);
    expect(listbox.className).toContain("max-h-[min(320px,40dvh)]");
    expect(listbox.className).toContain("overflow-y-auto");
    expect(screen.getByText("file-13.ts")).toBeTruthy();
  });

  it("renders a file-only list without group headings", () => {
    const { container } = renderSearch([fileItem(0), fileItem(1)]);

    expect(container.textContent).not.toContain("Context docs");
    expect(container.textContent).not.toContain("Files");
  });

  it("groups a mixed list with docs first and headings at each boundary", () => {
    renderSearch([
      docItem("doc-1", "01-plan.md", "Release checklist"),
      docItem("doc-2", "02-findings.md", null),
      fileItem(0),
    ]);

    const listbox = screen.getByRole("listbox", { name: "File mentions" });
    expect(screen.getByText("Context docs")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(3);
    // The doc row shows its filename, its run's label, and resolves its
    // tooltip to the path the mention will send.
    expect(rows[0]?.textContent).toContain("01-plan.md");
    expect(rows[0]?.textContent).toContain("Release checklist");
    expect(rows[0]?.title).toBe(".proliferate/context/01-plan.md");
    // A run without a definition title falls back to generic copy.
    expect(rows[1]?.textContent).toContain("Workflow run");
    // Headings are painted between rows in document order: docs lead.
    expect(listbox.textContent?.indexOf("Context docs"))
      .toBeLessThan(listbox.textContent?.indexOf("Files") ?? -1);
  });

  it("omits the Files heading when only docs match", () => {
    renderSearch([docItem("doc-1", "01-plan.md", null)]);

    expect(screen.getByText("Context docs")).toBeTruthy();
    expect(screen.queryByText("Files")).toBeNull();
  });

  it("keeps the flat highlight index across both groups", () => {
    const onSelect = vi.fn();
    renderSearch(
      [docItem("doc-1", "01-plan.md", null), fileItem(0)],
      onSelect,
    );

    const rows = screen.getAllByRole("option");
    expect(rows[0]?.id).toBe("file-result-0");
    expect(rows[1]?.id).toBe("file-result-1");
    rows[1]?.click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "file" }));
  });
});
