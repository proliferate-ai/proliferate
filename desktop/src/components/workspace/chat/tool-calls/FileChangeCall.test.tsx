import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileChangeCall } from "./FileChangeCall";

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

describe("FileChangeCall", () => {
  it("renders expanded edit diffs as file cards without an aggregate files-changed header", () => {
    const html = renderToStaticMarkup(
      createElement(FileChangeCall, {
        operation: "edit",
        path: "README.md",
        basename: "README.md",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
        status: "completed",
        defaultExpanded: true,
      }),
    );

    expect(html).toContain("Edited");
    expect(html).toContain("README.md");
    expect(html).toContain("data-diff-surface=\"chat\"");
    expect(html).toContain("thread-diff-virtualized");
    expect(html).toContain("overflow-x-auto overflow-y-auto");
    expect(html).toContain("max-h-[220px]");
    expect(html).not.toContain("flex min-w-0 flex-col gap-1");
    expect(html).not.toContain("1 file changed");
  });

  it("keeps expanded edit previews individually scrollable", () => {
    const html = renderToStaticMarkup(
      createElement(FileChangeCall, {
        operation: "create",
        path: "README.md",
        basename: "README.md",
        preview: "# README\n\nLong preview body",
        status: "completed",
        defaultExpanded: true,
      }),
    );

    expect(html).toContain("Long preview body");
    expect(html).toContain("max-h-[220px]");
  });
});
