import { readFileSync } from "node:fs";
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
  it("lets chat and sidebar diff unchanged rows reveal the diff body surface", () => {
    const desktopCss = readFileSync(
      new URL("../../../../../packages/design/src/css/product.css", import.meta.url),
      "utf8",
    );
    const sharedSurfaceRule =
      desktopCss.match(/\[data-diff-surface="chat"\] \.composer-diff-simple-line,\s*\[data-diff-surface="sidebar"\] \.composer-diff-simple-line \{(?<body>[\s\S]*?)\}/)
        ?.groups?.body ?? "";

    expect(sharedSurfaceRule).toContain("--codex-diffs-surface: var(--color-diff-main-surface);");
    expect(sharedSurfaceRule).toContain("--codex-diffs-context-number: transparent;");
    expect(sharedSurfaceRule).toContain("--diffs-bg-context-override: transparent;");
    expect(sharedSurfaceRule).toContain("background-color: var(--color-diff-code-surface);");
  });

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
    expect(html).toContain("sticky left-0 z-10 grid bg-[var(--diffs-bg)]");
    expect(html).toContain("data-content=\"\"");
    expect(html.match(/data-gutter=\"\"/g)).toHaveLength(1);
    expect(html.match(/data-content=\"\"/g)).toHaveLength(1);
    expect(html).toContain("grid-row:1 / span 4");
    expect(html).toContain("grid-template-rows:repeat(4, auto)");
    expect(html).toContain("[grid-template-rows:subgrid]");
    expect(html).toContain("--diffs-min-number-column-width:4ch");
    expect(html).toContain("--diffs-min-number-column-width-default:3ch");
    expect(html).toContain("--diffs-addition-color:var(--diffs-addition-color-override)");
    expect(html).toContain("--diffs-deletion-color:var(--diffs-deletion-color-override)");
    expect(html).toContain(
      "--diffs-column-number-width:max(40px, calc(4ch + 1.5rem))",
    );
    expect(html).toContain("pr-2 pl-3");
    expect(html).toContain("diff-content-cell relative min-h");
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

    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("sticky left-0 z-10");
    expect(html).toContain("min-w-max");
    expect(html).toContain("whitespace-pre");
    expect(html).not.toContain("overflow-clip");
  });

  it("wraps chat diff lines as inline text instead of flex items", () => {
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        patch: LONG_LINE_PATCH,
        filePath: "src/long.ts",
        variant: "chat",
        wrapLongLines: true,
      }),
    );

    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("diff-content-cell relative min-h");
    expect(html).toContain("block min-w-0 whitespace-pre-wrap break-words");
    expect(html).not.toContain("diff-content-cell relative flex");
  });

  it("clamps native overscroll on git diff viewers", () => {
    const chatHtml = renderToStaticMarkup(
      createElement(DiffViewer, {
        patch: PATCH,
        filePath: "src/example.ts",
        variant: "chat",
        overscrollBehaviorX: "none",
        overscrollBehaviorY: "none",
        chainVerticalWheel: true,
      }),
    );
    const splitHtml = renderToStaticMarkup(
      createElement(DiffViewer, {
        patch: PATCH,
        filePath: "src/example.ts",
        layout: "split",
        overscrollBehaviorX: "none",
        overscrollBehaviorY: "none",
        chainVerticalWheel: true,
      }),
    );

    expect(chatHtml).toContain("overscroll-behavior:none");
    expect(chatHtml).toContain("overscroll-behavior-x:none");
    expect(chatHtml).toContain("overscroll-behavior-y:none");
    expect(splitHtml).toContain("overscroll-behavior:none");
    expect(splitHtml).toContain("overscroll-behavior-x:none");
    expect(splitHtml).toContain("overscroll-behavior-y:none");
  });

  it("renders split diffs with Codex-style paired code columns", () => {
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        patch: PATCH,
        filePath: "src/example.ts",
        layout: "split",
      }),
    );

    expect(html).toContain("composer-diff-simple-line");
    expect(html).toContain("data-diff-type=\"split\"");
    expect(html).toContain("data-deletions=\"\"");
    expect(html).toContain("data-additions=\"\"");
    expect(html).toContain("data-container-size=\"\"");
    expect(html).toContain("data-line-type=\"change-deletion\"");
    expect(html).toContain("data-line-type=\"change-addition\"");
    expect(html).toContain("--diffs-column-content-width:360px");
    expect(html).toContain("--diffs-column-number-width:max(40px, calc(4ch + 1.5rem))");
    expect(html).toContain("[grid-template-rows:subgrid]");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("overflow-x-auto overflow-y-hidden");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(html).toContain("data-empty-side=\"change-deletion\"");
    expect(html).toContain("data-empty-side=\"change-addition\"");
    expect(html).toContain("data-gutter-buffer=\"buffer\"");
    expect(html).toContain("w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)]");
    expect(html).not.toContain("w-max min-w-full");
  });

  it("keeps diff viewer overscroll non-chaining by default", () => {
    const html = renderToStaticMarkup(
      createElement(DiffViewer, {
        patch: PATCH,
        filePath: "src/example.ts",
        variant: "chat",
      }),
    );

    expect(html).toContain("overscroll-behavior:none");
    expect(html).not.toContain("overscroll-behavior-y:");
  });
});
