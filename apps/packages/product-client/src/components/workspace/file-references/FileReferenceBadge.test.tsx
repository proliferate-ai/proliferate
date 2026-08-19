// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

const actionMocks = vi.hoisted(() => ({
  authority: "workspace" as "workspace" | "desktop" | "unavailable",
  pathKind: "file" as "file" | "directory" | null,
  pathKindPending: false,
  canOpenPrimary: true,
  copyPath: "/repo/src/App.tsx" as string | null,
  primaryUnavailableReason: null as string | null,
  openPrimary: vi.fn(),
  copyCurrentPath: vi.fn(async () => undefined),
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: ({ rawPath }: { rawPath: string }) => {
    const parsedPath = rawPath.trim();
    const locator = actionMocks.authority === "workspace"
      ? {
          authority: "workspace" as const,
          workspacePath: parsedPath,
          localCompanionPath: `/repo/${parsedPath}`,
        }
      : actionMocks.authority === "desktop"
        ? { authority: "desktop" as const, absolutePath: parsedPath, syntax: "absolute" as const }
        : { authority: "unavailable" as const, reason: parsedPath ? "invalid" as const : "empty" as const };
    return {
      reference: {
        rawPath,
        parsedPath,
        displayPath: parsedPath || "File",
        line: null,
        column: null,
        locator,
      },
      accessState: actionMocks.canOpenPrimary
        ? { status: "settled", locator, kind: actionMocks.pathKind }
        : { status: "unavailable", reason: "invalid" },
      nativePathKind: null,
      openTargets: [],
      defaultOpenTarget: null,
      pathKind: actionMocks.pathKind,
      pathKindPending: actionMocks.pathKindPending,
      canOpenInSidebar: actionMocks.canOpenPrimary,
      canOpenExternal: false,
      canOpenPrimary: actionMocks.canOpenPrimary,
      canReveal: false,
      primaryUnavailableReason: actionMocks.primaryUnavailableReason,
      copyPath: actionMocks.copyPath,
      copyCurrentPath: actionMocks.copyCurrentPath,
      openInSidebar: vi.fn(),
      openDefault: vi.fn(),
      openPrimary: actionMocks.openPrimary,
      openWithTarget: vi.fn(),
      reveal: vi.fn(),
    };
  },
}));

vi.mock("#product/hooks/workspaces/ui/files/use-file-reference-native-context-menu", () => ({
  useFileReferenceNativeContextMenu: () => ({ onContextMenuCapture: vi.fn() }),
}));

const webTestHost = makeTestProductHost({ desktop: null });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  actionMocks.authority = "workspace";
  actionMocks.pathKind = "file";
  actionMocks.pathKindPending = false;
  actionMocks.canOpenPrimary = true;
  actionMocks.copyPath = "/repo/src/App.tsx";
  actionMocks.primaryUnavailableReason = null;
});

describe("FileReferenceBadge glyph selection", () => {
  it("uses classified file glyphs for workspace and Desktop references", () => {
    const workspace = renderBadge("src/App.tsx");
    expect(usesExternalMentionGlyph(workspace.container)).toBe(false);
    workspace.unmount();

    actionMocks.authority = "desktop";
    const desktop = renderBadge("/Users/pablo/README.md");
    expect(usesExternalMentionGlyph(desktop.container)).toBe(false);
  });

  it("uses the mention glyph only for an unclassified Desktop file", () => {
    actionMocks.authority = "desktop";
    const { container } = renderBadge("/Users/pablo/some-notes");
    expect(usesExternalMentionGlyph(container)).toBe(true);
  });

  it("never uses the Desktop mention glyph for a workspace path", () => {
    const { container } = renderBadge("notes/some-notes");
    expect(usesExternalMentionGlyph(container)).toBe(false);
  });

  it("does not classify a directory by its filename-looking extension", () => {
    actionMocks.authority = "desktop";
    actionMocks.pathKind = "directory";
    const { container } = renderBadge("/Users/pablo/README.md");
    expect(usesExternalMentionGlyph(container)).toBe(true);
  });

  it("uses an explicit basename for glyph selection", () => {
    actionMocks.authority = "desktop";
    const { container } = renderBadge("/Users/pablo/scratch-file", "logo.svg");
    expect(usesExternalMentionGlyph(container)).toBe(false);
  });
});

describe("FileReferenceBadge interaction semantics", () => {
  it("renders and invokes an available primary action", () => {
    const { container } = renderBadge("src/App.tsx");
    const reference = container.querySelector("[data-file-reference-badge='inline']");
    expect(reference?.tagName).toBe("BUTTON");
    expect(reference?.className).toContain("text-link-foreground");
    fireEvent.click(reference!);
    expect(actionMocks.openPrimary).toHaveBeenCalledOnce();
  });

  it("renders a nonempty unavailable reference as inert text with Copy path only", () => {
    actionMocks.authority = "unavailable";
    actionMocks.pathKind = null;
    actionMocks.canOpenPrimary = false;
    actionMocks.copyPath = "missing.ts";
    const { container } = renderBadge("missing.ts");
    const reference = container.querySelector("[data-file-reference-badge='inline']");
    expect(reference?.tagName).toBe("SPAN");
    expect(reference?.className).not.toContain("text-link-foreground");

    fireEvent.contextMenu(reference!);
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();
    expect(screen.queryByText("Open externally")).toBeNull();
    expect(screen.queryByText("Reveal in Finder")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(actionMocks.copyCurrentPath).toHaveBeenCalledOnce();
  });

  it.each(["", "   "])("exposes no menu or primary control for %j", (rawPath) => {
    actionMocks.authority = "unavailable";
    actionMocks.pathKind = null;
    actionMocks.canOpenPrimary = false;
    actionMocks.copyPath = null;
    const { container } = renderBadge(rawPath);
    const reference = container.querySelector("[data-file-reference-badge='inline']");
    expect(reference?.tagName).toBe("SPAN");
    fireEvent.contextMenu(reference!);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(actionMocks.copyCurrentPath).not.toHaveBeenCalled();
  });
});

function renderBadge(rawPath: string, basename?: string) {
  return render(
    <ProductHostProvider host={webTestHost}>
      <FileReferenceBadge rawPath={rawPath} basename={basename} />
    </ProductHostProvider>,
  );
}

function usesExternalMentionGlyph(container: HTMLElement) {
  return container.querySelector("[data-external-path-reference-icon='true']") !== null;
}
