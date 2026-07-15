import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup as renderReactToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { FileChangeCall } from "./FileChangeCall";

const webTestHost = { desktop: null } as ProductHost;

function renderToStaticMarkup(ui: ReactElement) {
  return renderReactToStaticMarkup(
    <ProductHostProvider host={webTestHost}>{ui}</ProductHostProvider>,
  );
}

vi.mock("@/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
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
      }),
    );

    expect(html).toContain("README.md");
    expect(html).toContain("Edited");
    expect(html).toContain("--codex-diffs-header-surface:var(--color-diff-chat-inline-tool-header-surface)");
    expect(html).toContain("hover:bg-[var(--color-diff-chat-inline-tool-header-hover-surface)]");
    expect(html).toContain("data-diff-surface=\"chat\"");
    expect(html).toContain("thread-diff-virtualized");
    expect(html).toContain("overflow-x-auto overflow-y-auto");
    expect(html).toContain("max-h-[224px]");
    expect(html).not.toContain("Expand file diff");
    expect(html).not.toContain("Collapse file diff");
    expect(html).not.toContain("Toggle file diff");
    expect(html).not.toContain("data-app-action-review-file-toggle");
    expect(html).not.toContain("aria-label=\"Open README.md\"");
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
    expect(html).toContain("max-h-[224px]");
  });

  it("does not render oversized completed patches inline", () => {
    const largePatch = [
      "@@ -1 +1 @@",
      ...Array.from({ length: 5_001 }, (_, index) => `+generated ${index}`),
    ].join("\n");

    const html = renderToStaticMarkup(
      createElement(FileChangeCall, {
        operation: "edit",
        path: "anyharness/sdk/generated/openapi.json",
        basename: "openapi.json",
        additions: 5_001,
        deletions: 0,
        patch: largePatch,
        status: "completed",
        defaultExpanded: true,
      }),
    );

    expect(html).toContain("Too large to render inline");
    expect(html).not.toContain("overflow-x-auto overflow-y-auto");
  });
});
