// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const MULTI_HUNK_PATCH = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,2 +1,2 @@
-export const first = "old";
+export const first = "new";
 export const firstDone = true;
@@ -10,2 +10,2 @@
-export const second = "old";
+export const second = "new";
 export const secondDone = true;`;

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

describe("ChatDiffViewer hunk actions", () => {
  beforeEach(() => {
    resetContentSearchStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts wrap-off actions before hover with scrollport placement and focus reveal", () => {
    const onRevert = vi.fn();
    const onStageOrUnstage = vi.fn();
    const view = renderWithHost(
      <ChatDiffViewer
        parsed={parsePatch(PATCH)}
        tokens={null}
        wrapLongLines={false}
        hunkActions={{
          mode: "unstaged",
          disabled: false,
          onRevert,
          onStageOrUnstage,
        }}
      />,
    );

    const revert = screen.getByRole("button", { name: "Revert hunk" });
    const stage = screen.getByRole("button", { name: "Stage hunk" });
    const pill = revert.closest("div");
    const firstRow = revert.closest("[data-line-index]");

    expect(pill?.className).toContain("sticky right-2 ms-auto shrink-0");
    expect(pill?.className).toContain("opacity-0 pointer-events-none");
    expect(pill?.className).toContain("group-focus-within/hunk:opacity-100");
    expect(firstRow?.className).toContain("group/hunk");
    expect(firstRow?.className).toContain("pr-2");
    expect(firstRow?.className).not.toContain("pr-3");
    expect(view.container.querySelector("pre")?.tabIndex).toBe(0);

    fireEvent.click(revert);
    fireEvent.click(stage);
    expect(onRevert).toHaveBeenCalledWith(0);
    expect(onStageOrUnstage).toHaveBeenCalledWith(0);
  });

  it("keeps wrap-on staged actions at the line end", () => {
    const onStageOrUnstage = vi.fn();
    renderWithHost(
      <ChatDiffViewer
        parsed={parsePatch(PATCH)}
        tokens={null}
        wrapLongLines
        hunkActions={{
          mode: "staged",
          disabled: false,
          onRevert: vi.fn(),
          onStageOrUnstage,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Revert hunk" })).toBeNull();
    const unstage = screen.getByRole("button", { name: "Unstage hunk" });
    expect(unstage.closest("div")?.className).toContain("absolute right-2 top-0");
    expect(unstage.closest("div")?.className).not.toContain("sticky");
    expect(unstage.closest("[data-line-index]")?.className).toContain("pr-3");

    fireEvent.click(unstage);
    expect(onStageOrUnstage).toHaveBeenCalledWith(0);
  });

  it("orders actions by hunk and keeps disabled mutations disabled", () => {
    const actions = {
      mode: "unstaged" as const,
      disabled: true,
      onRevert: vi.fn(),
      onStageOrUnstage: vi.fn(),
    };
    const view = renderWithHost(
      <ChatDiffViewer
        parsed={parsePatch(MULTI_HUNK_PATCH)}
        tokens={null}
        wrapLongLines={false}
        hunkActions={actions}
      />,
    );

    const actionLabels = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('button[aria-label$="hunk"]'),
      (button) => button.getAttribute("aria-label"),
    );
    expect(actionLabels).toEqual([
      "Revert hunk",
      "Stage hunk",
      "Revert hunk",
      "Stage hunk",
    ]);
    expect(screen.getAllByRole("button", { name: "Revert hunk" }).every(
      (button) => (button as HTMLButtonElement).disabled,
    )).toBe(true);
    expect(screen.getAllByRole("button", { name: "Stage hunk" }).every(
      (button) => (button as HTMLButtonElement).disabled,
    )).toBe(true);
  });

  it("does not mount hunk buttons without mutation actions", () => {
    const view = renderWithHost(
      <ChatDiffViewer
        parsed={parsePatch(PATCH)}
        tokens={null}
        wrapLongLines={false}
        hunkActions={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Revert hunk" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stage hunk" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unstage hunk" })).toBeNull();
    expect(view.container.querySelector("[data-content] [data-line-index]")?.className)
      .toContain("pr-3");
  });
});
