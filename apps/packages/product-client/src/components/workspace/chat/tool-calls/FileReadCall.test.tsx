// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";
import { FileReadCall } from "#product/components/workspace/chat/tool-calls/FileReadCall";

// The real FileReferenceBadge renders here on purpose: the property under test
// is which element owns the hover promotion, and a stub badge cannot answer
// that.
vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: ({ rawPath }: { rawPath: string }) => ({
    reference: {
      rawPath,
      path: rawPath,
      line: null,
      column: null,
      absolutePath: `/repo/${rawPath}`,
      workspacePath: rawPath,
    },
    pathKind: "file",
    pathKindPending: false,
    canOpenPrimary: true,
    primaryActionFailed: false,
    primaryUnavailableReason: null,
    openPrimary: vi.fn(),
  }),
}));

vi.mock("#product/hooks/workspaces/ui/files/use-file-reference-native-context-menu", () => ({
  useFileReferenceNativeContextMenu: () => ({ onContextMenuCapture: vi.fn() }),
}));

const webTestHost = makeTestProductHost({ desktop: null });

afterEach(cleanup);

function renderReadCall({ preview }: { preview?: string } = {}) {
  return render(
    <ProductHostProvider host={webTestHost}>
      <FileReadCall
        path="src/reader.ts"
        workspacePath="src/reader.ts"
        basename="reader.ts"
        scope="range"
        startLine={4}
        endLine={18}
        preview={preview}
        status="completed"
      />
    </ProductHostProvider>,
  );
}

describe("FileReadCall", () => {
  it("keeps the read scope inside the glyph-free file reference", () => {
    const { container } = renderReadCall();
    const badge = container.querySelector("[data-file-reference-badge='plain']");

    expect(container.textContent).toContain("Read");
    expect(badge?.textContent).toBe("reader.ts (lines 4–18)");
    // A read reference carries no leading file-type glyph; the row's own read
    // glyph is the only one.
    expect(badge?.querySelector("span[aria-hidden='true']")).toBeNull();
  });

  it("promotes only the filename on hover, never the whole row", () => {
    // An expandable read row is the case that could promote its whole label:
    // FileReadCall opts out with promoteOnHover={false} so hovering lifts the
    // filename alone.
    const { container } = renderReadCall({ preview: "const reader = true;" });
    const badge = container.querySelector("[data-file-reference-badge='plain']");
    const row = container.querySelector("[data-tool-action-row]");

    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(badge?.className).toContain("hover:text-foreground");
    expect(row?.className).not.toContain("hover:text-foreground");
  });
});
