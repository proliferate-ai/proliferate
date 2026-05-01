import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffViewer } from "./DiffViewer";

const PATCH = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1000,3 +1000,3 @@
 export const value = 1;
-export const oldName = "old";
+export const newName = "new";
 export const done = true;`;

const LONG_LINE_PATCH = `diff --git a/src/long.ts b/src/long.ts
index 1111111..2222222 100644
--- a/src/long.ts
+++ b/src/long.ts
@@ -1 +1 @@
-const message = "${"old ".repeat(80)}";
+const message = "${"new ".repeat(80)}";`;

describe("DiffViewer chat variant", () => {
  it("renders Codex-style data attributes and dynamic gutter width", () => {
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        patch: PATCH,
        filePath: "src/example.ts",
        variant: "chat",
      }),
    );

    expect(html).toContain("composer-diff-simple-line");
    expect(html).toContain("data-diff=\"\"");
    expect(html).toContain("data-code=\"\"");
    expect(html).toContain("data-gutter=\"\"");
    expect(html).toContain("sticky left-0 z-10");
    expect(html).toContain("data-content=\"\"");
    expect(html).toContain("--diffs-min-number-column-width:4ch");
    expect(html).toContain("--diffs-min-number-column-width-default:3ch");
    expect(html).toContain("--diffs-addition-color:var(--diffs-addition-color-override)");
    expect(html).toContain("--diffs-deletion-color:var(--diffs-deletion-color-override)");
    expect(html).toContain(
      "--diffs-column-number-width:max(24px, 5ch)",
    );
    expect(html).toContain("diff-content-cell relative flex");
    expect(html).not.toContain("thread-diff-virtualized");
  });

  it("keeps long unwrapped chat diff lines horizontally scrollable", () => {
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        patch: LONG_LINE_PATCH,
        filePath: "src/long.ts",
        variant: "chat",
      }),
    );

    expect(html).toContain("overflow-x-auto overflow-y-auto");
    expect(html).toContain("sticky left-0 z-10");
    expect(html).toContain("min-w-max");
    expect(html).toContain("whitespace-pre");
    expect(html).not.toContain("overflow-clip");
  });
});
