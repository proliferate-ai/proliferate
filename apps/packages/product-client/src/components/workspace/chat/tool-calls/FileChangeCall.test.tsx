import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup as renderReactToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { FileChangeCall } from "#product/components/workspace/chat/tool-calls/FileChangeCall";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

// A complete web host (desktop: null). The moved code block reads
// useProductHost().clipboard for its copy control, so a bare { desktop: null }
// cast (no clipboard) crashes; makeTestProductHost supplies every capability.
const webTestHost = makeTestProductHost({ desktop: null });
const { fileReferenceActionState, fileReferenceActionsCalls } = vi.hoisted(() => ({
  fileReferenceActionsCalls: [] as Array<{ rawPath: string; workspacePath?: string | null }>,
  fileReferenceActionState: {
  canOpenInSidebar: true,
  canOpenExternal: true,
  canOpenPrimary: true,
  },
}));

function renderToStaticMarkup(ui: ReactElement) {
  return renderReactToStaticMarkup(
    <ProductHostProvider host={webTestHost}>{ui}</ProductHostProvider>,
  );
}

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: (args: { rawPath: string; workspacePath?: string | null }) => {
    fileReferenceActionsCalls.push(args);
    const locator = {
      authority: "workspace" as const,
      workspacePath: typeof args.workspacePath === "string" ? args.workspacePath : args.rawPath,
      localCompanionPath: null,
    };
    return {
      reference: {
      rawPath: args.rawPath,
      parsedPath: args.rawPath,
      displayPath: args.rawPath || "File",
      line: null,
      column: null,
      locator,
      },
      accessState: { status: "settled", locator, kind: "file" },
      nativePathKind: null,
      openTargets: [],
      defaultOpenTarget: null,
      pathKind: "file",
      pathKindPending: false,
      canReveal: false,
      primaryUnavailableReason: null,
      copyPath: args.rawPath || null,
      copyCurrentPath: vi.fn(),
      canOpenInSidebar: fileReferenceActionState.canOpenInSidebar,
      canOpenExternal: fileReferenceActionState.canOpenExternal,
      canOpenPrimary: fileReferenceActionState.canOpenPrimary,
      openInSidebar: vi.fn(),
      openDefault: vi.fn(),
      openPrimary: vi.fn(),
      openWithTarget: vi.fn(),
      reveal: vi.fn(),
    };
  },
}));

afterEach(() => {
  fileReferenceActionState.canOpenInSidebar = true;
  fileReferenceActionState.canOpenExternal = true;
  fileReferenceActionState.canOpenPrimary = true;
  fileReferenceActionsCalls.length = 0;
});

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
    expect(html).toContain("--diff-view-header-surface:var(--color-diff-chat-inline-tool-header-surface)");
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

  it("keeps a retryable unresolved file path clickable", () => {
    fileReferenceActionState.canOpenInSidebar = false;
    fileReferenceActionState.canOpenExternal = false;
    fileReferenceActionState.canOpenPrimary = true;

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

    expect(html).toContain("select-text [direction:rtl]");
  });

  it("keeps raw and explicitly blank structured destination paths separate", () => {
    renderToStaticMarkup(
      <FileChangeCall
        operation="move"
        path="old/raw.ts"
        workspacePath="old/workspace.ts"
        newPath="new/raw.ts"
        newWorkspacePath=""
        status="completed"
      />,
    );

    expect(fileReferenceActionsCalls).toContainEqual({
      rawPath: "new/raw.ts",
      workspacePath: "",
    });
  });

  it("routes a move outside the workspace to its destination, not the source", () => {
    renderToStaticMarkup(
      <FileChangeCall
        operation="move"
        path="src/a.ts"
        workspacePath="src/a.ts"
        newPath="/tmp/a.ts"
        newWorkspacePath={null}
        status="completed"
      />,
    );

    // The component's own primary file-reference actions (used for open/copy)
    // are established before any child chip renders, so this is always the
    // first call recorded — child label chips make their own independent
    // calls that must not be mistaken for the parent's.
    expect(fileReferenceActionsCalls[0]).toEqual({
      rawPath: "/tmp/a.ts",
      workspacePath: null,
    });
  });

  it("keeps workspacePath for a plain edit with no newPath", () => {
    renderToStaticMarkup(
      <FileChangeCall
        operation="edit"
        path="src/a.ts"
        workspacePath="src/a.ts"
        status="completed"
      />,
    );

    expect(fileReferenceActionsCalls[0]).toEqual({
      rawPath: "src/a.ts",
      workspacePath: "src/a.ts",
    });
  });
});
