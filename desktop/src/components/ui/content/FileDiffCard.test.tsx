import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileChangesCard, FileDiffCard } from "./FileDiffCard";

describe("FileChangesCard and FileDiffCard", () => {
  it("keeps aggregate headers clean and renders the sidebar-safe shared anatomy", () => {
    const html = renderToStaticMarkup(
      createElement(FileChangesCard, {
        fileCount: 2,
        children: createElement(
          FileDiffCard,
          {
            filePath: "desktop/src/components/workspace/git/GitPanel.tsx",
            additions: 4,
            deletions: 1,
            isExpanded: true,
            onToggleExpand: () => {},
            surface: "sidebar",
          },
          createElement("div", null, "diff body"),
        ),
      }),
    );

    expect(html).toContain("2 files changed");
    expect(html).not.toContain("+7");
    expect(html).not.toContain("text-git-red\">-3</span>");
    expect(html).toContain("+4");
    expect(html).toContain("-1");
    expect(html).toContain("bg-[var(--color-diff-panel-surface)]");
    expect(html).toContain("text-chat leading-[var(--text-chat--line-height)]");
    expect(html).toContain("thread-diff-virtualized");
    expect(html).toContain("--codex-diffs-surface:var(--codex-diffs-surface-override, var(--color-diff-surface))");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("text-sidebar-foreground");
    expect(html).toContain("hover:bg-sidebar-accent");
    expect(html).toContain("diff body");
  });
});
