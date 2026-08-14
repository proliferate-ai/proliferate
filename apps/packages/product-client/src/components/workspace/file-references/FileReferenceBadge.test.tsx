// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";
import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";

// FileReferenceBadge picks a glyph by combining `actions.pathKind` with
// `getFileVisual` (the single extension->visual table) and only falls back to
// the generic external-mention glyph when the name is genuinely unclassifiable
// AND the reference is an external (non-workspace) path. That combination —
// not `getFileVisual` or the label helpers individually, which already have
// their own direct tests — is what this file exercises.

type MockActionsState = {
  pathKind: "file" | "directory" | null;
  pathKindPending: boolean;
  workspacePath: string | null;
  absolutePath: string | null;
  canOpenPrimary: boolean;
  primaryUnavailableReason: string | null;
};

const state: MockActionsState = {
  pathKind: "file",
  pathKindPending: false,
  workspacePath: "src/App.tsx",
  absolutePath: "/repo/src/App.tsx",
  canOpenPrimary: true,
  primaryUnavailableReason: null,
};

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: ({ rawPath }: { rawPath: string }) => ({
    reference: {
      rawPath,
      path: rawPath,
      line: null,
      column: null,
      absolutePath: state.absolutePath,
      workspacePath: state.workspacePath,
    },
    pathKind: state.pathKind,
    pathKindPending: state.pathKindPending,
    canOpenPrimary: state.canOpenPrimary,
    primaryUnavailableReason: state.primaryUnavailableReason,
    openPrimary: vi.fn(),
  }),
}));

vi.mock("#product/hooks/workspaces/ui/files/use-file-reference-native-context-menu", () => ({
  useFileReferenceNativeContextMenu: () => ({ onContextMenuCapture: vi.fn() }),
}));

const webTestHost = makeTestProductHost({ desktop: null });

function renderBadge(rawPath: string, basename?: string) {
  return render(
    <ProductHostProvider host={webTestHost}>
      <FileReferenceBadge rawPath={rawPath} basename={basename} />
    </ProductHostProvider>,
  );
}

function renderPlainBadge(rawPath: string) {
  return render(
    <ProductHostProvider host={webTestHost}>
      <FileReferenceBadge rawPath={rawPath} variant="plain" />
    </ProductHostProvider>,
  );
}

function glyphSpan(container: HTMLElement) {
  return container.querySelector("[data-file-reference-badge] span[aria-hidden='true']");
}

function usesExternalMentionGlyph(container: HTMLElement) {
  return container.querySelector("[data-external-path-reference-icon='true']") !== null;
}

afterEach(() => {
  cleanup();
  state.pathKind = "file";
  state.pathKindPending = false;
  state.workspacePath = "src/App.tsx";
  state.absolutePath = "/repo/src/App.tsx";
  state.canOpenPrimary = true;
  state.primaryUnavailableReason = null;
});

describe("FileReferenceBadge glyph selection", () => {
  it("shows the real file-type glyph for a workspace file with a classified extension", () => {
    const { container } = renderBadge("src/App.tsx");
    expect(usesExternalMentionGlyph(container)).toBe(false);
    expect(glyphSpan(container)).toBeTruthy();
  });

  it("shows the markdown glyph for an external reference to a classified extension", () => {
    state.workspacePath = null;
    state.absolutePath = "/Users/pablo/notes/README.md";
    const { container } = renderBadge("/Users/pablo/notes/README.md");
    // The whole point of the file-type-glyph fix: an out-of-workspace
    // reference to a recognizable extension gets its real glyph, not the
    // generic mention icon.
    expect(usesExternalMentionGlyph(container)).toBe(false);
  });

  it("falls back to the generic mention glyph for an external reference with no classified extension", () => {
    state.workspacePath = null;
    state.absolutePath = "/Users/pablo/notes/some-notes";
    const { container } = renderBadge("/Users/pablo/notes/some-notes");
    expect(usesExternalMentionGlyph(container)).toBe(true);
  });

  it("never falls back to the mention glyph for a workspace reference, even with no classified extension", () => {
    // useExternalInlineIcon requires !reference.workspacePath, so a reference
    // resolved inside the workspace always renders FileTreeEntryIcon (which
    // itself resolves to the "default" file glyph) instead of the mention icon.
    state.workspacePath = "notes/some-notes";
    state.absolutePath = "/repo/notes/some-notes";
    const { container } = renderBadge("notes/some-notes");
    expect(usesExternalMentionGlyph(container)).toBe(false);
  });

  it("treats a directory as unclassified even when its name looks like a recognized file", () => {
    // hasFileTypeGlyph is gated on pathKind !== "directory": a directory
    // named like a markdown file must not pick up the markdown glyph.
    state.pathKind = "directory";
    state.workspacePath = null;
    state.absolutePath = "/Users/pablo/notes/README.md";
    const { container } = renderBadge("/Users/pablo/notes/README.md");
    expect(usesExternalMentionGlyph(container)).toBe(true);
  });

  it("shows a classified glyph for a still-resolving external reference (pending stat does not block the extension lookup)", () => {
    // hasFileTypeGlyph is computed off resolvedBasename/iconPath, not off
    // pathKindPending, so a reference whose workspace stat hasn't resolved
    // yet still gets the markdown glyph rather than waiting or showing the
    // mention icon in the meantime.
    state.pathKind = null;
    state.pathKindPending = true;
    state.workspacePath = null;
    state.absolutePath = "/Users/pablo/notes/README.md";
    const { container } = renderBadge("/Users/pablo/notes/README.md");
    expect(usesExternalMentionGlyph(container)).toBe(false);
  });

  it("uses an explicit basename override for glyph selection instead of the raw path", () => {
    state.workspacePath = null;
    state.absolutePath = "/Users/pablo/tmp/scratch-file";
    const { container } = renderBadge("/Users/pablo/tmp/scratch-file", "logo.svg");
    expect(usesExternalMentionGlyph(container)).toBe(false);
  });
});

describe("FileReferenceBadge interaction semantics", () => {
  it("renders an actionable inline reference as a blue button", () => {
    const { container } = renderBadge("src/App.tsx");
    const reference = container.querySelector("[data-file-reference-badge='inline']");

    expect(reference?.tagName).toBe("BUTTON");
    expect(reference?.getAttribute("aria-disabled")).toBeNull();
    expect(reference?.className).toContain("text-link-foreground");
    expect(reference?.className).not.toContain("cursor-not-allowed");
  });

  it("keeps the full destination in the actionable reference tooltip", () => {
    state.primaryUnavailableReason = "Could not resolve this path. Click to retry.";
    const { container } = renderBadge("src/App.tsx");
    const reference = container.querySelector("[data-file-reference-badge='inline']");

    expect(reference?.getAttribute("title"))
      .toBe("/repo/src/App.tsx");
  });

  it("renders an unavailable reference as plain text instead of a disabled link", () => {
    state.canOpenPrimary = false;
    const { container } = renderBadge("/tmp/unavailable.txt");
    const reference = container.querySelector("[data-file-reference-badge='inline']");

    expect(reference?.tagName).toBe("SPAN");
    expect(reference?.getAttribute("aria-disabled")).toBeNull();
    expect(reference?.className).not.toContain("text-link-foreground");
    expect(reference?.className).not.toContain("cursor-not-allowed");
    expect(reference?.className).toContain("cursor-default");
    expect(glyphSpan(container)).toBeNull();
  });

  it("renders tool-call references without a glyph in the row color", () => {
    const { container } = renderPlainBadge("src/App.tsx");
    const reference = container.querySelector("[data-file-reference-badge='plain']");

    expect(reference?.tagName).toBe("BUTTON");
    expect(reference?.className).toContain("text-current");
    expect(reference?.className).toContain("decoration-dotted");
    expect(reference?.className).not.toContain("text-link-foreground");
    expect(glyphSpan(container)).toBeNull();
  });
});
