// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerFileMentionSearch } from "#product/components/workspace/chat/input/ComposerFileMentionSearch";

afterEach(cleanup);

describe("ComposerFileMentionSearch", () => {
  it("renders long result sets inside the shared scrolling listbox", () => {
    const results = Array.from({ length: 14 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      name: `file-${index}.ts`,
      parent: "src",
    }));

    render(
      <ComposerFileMentionSearch
        results={results}
        highlightedIndex={0}
        listRef={createRef<HTMLDivElement>()}
        query="file"
        isLoading={false}
        isError={false}
        isPending={false}
        runtimeReady
        onSelect={vi.fn()}
        onRowMouseEnter={vi.fn()}
        setRowRef={vi.fn()}
        getRowId={(index) => `file-result-${index}`}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "File mentions" });
    expect(screen.getAllByRole("option")).toHaveLength(14);
    expect(listbox.className).toContain("max-h-[min(320px,40dvh)]");
    expect(listbox.className).toContain("overflow-y-auto");
    expect(screen.getByText("file-13.ts")).toBeTruthy();
  });
});
