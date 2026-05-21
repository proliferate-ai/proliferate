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
    expect(html).not.toContain(">-3</span>");
    expect(html).toContain(">+4</span>");
    expect(html).toContain(">-1</span>");
    expect(html).toContain("bg-[var(--color-diff-panel-surface)]");
    expect(html).toContain("text-chat leading-[var(--text-chat--line-height)]");
    expect(html).not.toContain("thread-diff-virtualized");
    expect(html).toContain("--codex-diffs-surface:var(--codex-diffs-surface-override, var(--color-diff-surface))");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("codex-review-diff-card");
    expect(html).toContain("data-app-action-review-file-expanded=\"true\"");
    expect(html).toContain("data-app-action-review-file-toggle=\"\"");
    expect(html).toContain("text-sidebar-foreground");
    expect(html).toContain("hover:bg-sidebar-accent");
    expect(html).toContain("diff body");
  });

  it("keeps absolute paths compact in diff headers", () => {
    const html = renderToStaticMarkup(
      createElement(FileDiffCard, {
        filePath: "/Users/pablo/.claude/plans/sorry-im-eant-liek-moonlit-goose.md",
        additions: 20,
        deletions: 0,
        isExpanded: false,
        onToggleExpand: () => {},
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain("sorry-im-eant-liek-moonlit-goose.md");
    expect(html).toContain(">.claude/plans/sorry-im-eant-liek-moonlit-goose.md</span>");
    expect(html).not.toContain(">/Users/pablo/.claude/plans/sorry-im-eant-liek-moonlit-goose.md</span>");
    expect(html).not.toContain("hover:underline");
    expect(html).toContain("thread-diff-virtualized");
    expect(html).toContain("group-hover/diff-header:block");
  });

  it("marks truncated absolute path prefixes with an ellipsis", () => {
    const html = renderToStaticMarkup(
      createElement(FileDiffCard, {
        filePath: "/Users/pablo/projects/proliferate/desktop/src/components/ui/content/FileDiffCard.tsx",
        additions: 1,
        deletions: 0,
        isExpanded: false,
        onToggleExpand: () => {},
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain(">.../ui/content/FileDiffCard.tsx</span>");
  });

  it("renders fallback metadata for zero-stat sidebar rows", () => {
    const html = renderToStaticMarkup(
      createElement(FileDiffCard, {
        filePath: "new-file.ts",
        additions: 0,
        deletions: 0,
        isExpanded: false,
        onToggleExpand: () => {},
        metadata: createElement("span", { "aria-label": "Added" }, "A"),
        surface: "sidebar",
      }),
    );

    expect(html).toContain("aria-label=\"Added\"");
    expect(html).toContain(">A</span>");
  });
});
