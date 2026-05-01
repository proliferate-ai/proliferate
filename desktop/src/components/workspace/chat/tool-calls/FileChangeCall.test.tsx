import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileChangeCall } from "./FileChangeCall";

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
    expect(html).not.toContain("max-h-[220px]");
    expect(html).not.toContain("1 file changed");
  });

  it("does not cap expanded edit previews", () => {
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
    expect(html).not.toContain("max-h-[220px]");
  });
});
