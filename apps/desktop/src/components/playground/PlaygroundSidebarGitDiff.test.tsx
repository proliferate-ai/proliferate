import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup as renderReactToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { PlaygroundSidebarGitDiff } from "./PlaygroundSidebarGitDiff";

const webTestHost = { desktop: null } as ProductHost;

function renderToStaticMarkup(ui: ReactElement) {
  return renderReactToStaticMarkup(
    <ProductHostProvider host={webTestHost}>{ui}</ProductHostProvider>,
  );
}

describe("PlaygroundSidebarGitDiff", () => {
  it("renders sidebar-shaped git diff states with production diff components", () => {
    const html = renderToStaticMarkup(createElement(PlaygroundSidebarGitDiff));

    expect(html).toContain("bg-sidebar-background");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("data-diff=\"\"");
    expect(html).toContain("composer-diff-simple-line");
    expect(html).toContain("id=\"review-diffs-collapsed\"");
    expect(html).toContain("data-app-action-review-scroll=\"\"");
    expect(html).toContain("data-thread-find-target=\"review\"");
    expect(html).toContain("data-app-action-review-metrics-probe=\"\"");
    expect(html).toContain("data-review-path=");
    expect(html).toContain("codex-review-diff-card");
    expect(html).toContain("px-2 pb-3");
    expect(html).toContain("pt-2");
    expect(html).not.toContain("px-2 py-2");
    expect(html).toContain("Binary file changed");
    expect(html).toContain("Diff truncated");
    expect(html).toContain("Working tree clean");
  });
});
