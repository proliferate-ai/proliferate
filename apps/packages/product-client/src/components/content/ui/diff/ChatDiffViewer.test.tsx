// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { ChatDiffViewer } from "#product/components/content/ui/diff/ChatDiffViewer";
import { parsePatch } from "#product/lib/domain/files/diff-parser";
import { useContentSearchStore } from "#product/stores/search/content-search-store";

const webTestHost = { desktop: null } as ProductHost;

function renderWithHost(ui: ReactElement) {
  return render(createElement(ProductHostProvider, { host: webTestHost, children: ui }));
}

function resetContentSearchStore() {
  useContentSearchStore.setState({
    open: false,
    query: "",
    surface: "chat",
    activeMatchIndex: 0,
    activeMatchId: null,
    unitsById: {},
    nextUnitOrder: 0,
    surfaceAvailability: { file: false, review: false },
  });
}

const PATCH = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,2 +1,2 @@
-export const oldName = "old";
+export const newName = "new";
 export const done = true;`;

describe("ChatDiffViewer content search registration", () => {
  beforeEach(() => {
    resetContentSearchStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers its unit under the review surface when contentSearchSurface is review", () => {
    const parsed = parsePatch(PATCH);

    renderWithHost(
      createElement(ChatDiffViewer, {
        parsed,
        tokens: null,
        wrapLongLines: false,
        contentSearchUnitId: "review-diff:test",
        contentSearchSurface: "review",
      }),
    );

    const unit = useContentSearchStore.getState().unitsById["review-diff:test"];
    expect(unit?.surface).toBe("review");
  });

  it("defaults its unit to the chat surface when contentSearchSurface is omitted", () => {
    const parsed = parsePatch(PATCH);

    renderWithHost(
      createElement(ChatDiffViewer, {
        parsed,
        tokens: null,
        wrapLongLines: false,
        contentSearchUnitId: "chat-diff:test",
      }),
    );

    const unit = useContentSearchStore.getState().unitsById["chat-diff:test"];
    expect(unit?.surface).toBe("chat");
  });
});
