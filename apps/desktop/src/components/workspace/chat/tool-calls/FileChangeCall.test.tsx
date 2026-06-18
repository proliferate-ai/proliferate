import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileChangeCall } from "./FileChangeCall";

const fileReferenceActionsMock = vi.hoisted(() => ({
  calls: [] as Array<{ rawPath: string; workspacePath?: string | null; authoritativePath?: boolean }>,
}));

vi.mock("@/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: (input: {
    rawPath: string;
    workspacePath?: string | null;
    authoritativePath?: boolean;
  }) => {
    fileReferenceActionsMock.calls.push(input);
    return {
      reference: {
        rawPath: input.rawPath,
        path: input.rawPath,
        line: null,
        column: null,
        absolutePath: `/repo/${input.rawPath}`,
        workspacePath: input.rawPath,
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
    };
  },
}));

afterEach(() => {
  fileReferenceActionsMock.calls.length = 0;
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

  it("opens the move destination authoritatively (matches the label's target chip)", () => {
    renderToStaticMarkup(
      createElement(FileChangeCall, {
        operation: "move",
        path: "src/old/Foo.tsx",
        workspacePath: "src/old/Foo.tsx",
        basename: "Foo.tsx",
        newPath: "src/new/Foo.tsx",
        newWorkspacePath: "src/new/Foo.tsx",
        newBasename: "Foo.tsx",
        status: "completed",
      }),
    );

    // The component resolves its own diff-card open target before rendering the
    // label chips, so calls[0] is the diff card's actions hook.
    const diffCardCall = fileReferenceActionsMock.calls[0];
    expect(diffCardCall?.rawPath).toBe("src/new/Foo.tsx");
    expect(diffCardCall?.workspacePath).toBe("src/new/Foo.tsx");
    expect(diffCardCall?.authoritativePath).toBe(true);
  });
});
