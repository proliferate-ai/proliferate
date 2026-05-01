import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaygroundSidebarGitDiff } from "./PlaygroundSidebarGitDiff";

describe("PlaygroundSidebarGitDiff", () => {
  it("renders sidebar-shaped git diff states with production diff components", () => {
    const html = renderToStaticMarkup(createElement(PlaygroundSidebarGitDiff));

    expect(html).toContain("bg-sidebar-background");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("data-diff=\"\"");
    expect(html).toContain("composer-diff-simple-line");
    expect(html).toContain("Binary file changed");
    expect(html).toContain("Diff truncated");
    expect(html).toContain("Working tree clean");
  });
});
