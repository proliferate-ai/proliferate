// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import {
  CHAT_DIFF_PREFERENCES_STORAGE_KEY,
  useChatDiffPreferencesStore,
} from "@/stores/chat/chat-diff-preferences-store";
import { buildChatDiffLineWrapNativeContextMenuItems } from "./ChatDiffLineWrapContextMenu";

const LONG_LINE_PATCH = `diff --git a/src/long.ts b/src/long.ts
index 1111111..2222222 100644
--- a/src/long.ts
+++ b/src/long.ts
@@ -1 +1 @@
-const message = "${"old ".repeat(80)}";
+const message = "${"new ".repeat(80)}";`;

beforeEach(() => {
  window.localStorage.clear();
  useChatDiffPreferencesStore.getState().setWrapLongLines(false);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ChatDiffLineWrapContextMenu", () => {
  it("toggles persisted line wrapping for every chat diff body", () => {
    const { container } = render(
      <div>
        <DiffViewer patch={LONG_LINE_PATCH} filePath="src/one.ts" variant="chat" />
        <DiffViewer patch={LONG_LINE_PATCH} filePath="src/two.ts" variant="chat" />
      </div>,
    );

    expect(container.innerHTML).toContain("overflow-x-auto");
    expect(container.innerHTML).not.toContain("whitespace-pre-wrap");

    const triggers = container.querySelectorAll(
      '[data-chat-diff-wrap-context-trigger="body"]',
    );
    expect(triggers).toHaveLength(2);

    fireEvent.contextMenu(triggers[0]);
    fireEvent.click(screen.getByRole("button", { name: "Turn line wrapping on" }));

    expect(JSON.parse(window.localStorage.getItem(CHAT_DIFF_PREFERENCES_STORAGE_KEY)!))
      .toEqual({ wrapLongLines: true });
    for (const trigger of triggers) {
      expect(trigger.className).toContain("overflow-x-hidden");
    }
    expect(container.innerHTML.match(/whitespace-pre-wrap/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });

  it("opens the same global wrap toggle from chat file headers", () => {
    const { container } = render(
      createElement(
        FileDiffCard,
        {
          filePath: "src/long.ts",
          additions: 1,
          deletions: 1,
          isExpanded: true,
          onToggleExpand: () => {},
        },
        createElement(DiffViewer, {
          patch: LONG_LINE_PATCH,
          filePath: "src/long.ts",
          variant: "chat",
        }),
      ),
    );

    const header = container.querySelector(
      '[data-chat-diff-wrap-context-trigger="file-header"]',
    );
    expect(header).not.toBeNull();

    fireEvent.contextMenu(header!);
    fireEvent.click(screen.getByRole("button", { name: "Turn line wrapping on" }));

    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);
    expect(container.innerHTML).toContain("overflow-x-hidden");
  });

  it("builds native menu items for the same global wrap action", () => {
    let toggled = false;
    const items = buildChatDiffLineWrapNativeContextMenuItems({
      wrapLongLines: false,
      onToggleWrapLongLines: () => {
        toggled = true;
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "toggle-chat-diff-line-wrap",
      label: "Turn line wrapping on",
    });

    if ("onSelect" in items[0]) {
      items[0].onSelect?.();
    }
    expect(toggled).toBe(true);

    expect(buildChatDiffLineWrapNativeContextMenuItems({
      wrapLongLines: true,
      onToggleWrapLongLines: () => {},
    })[0]).toMatchObject({
      label: "Turn line wrapping off",
    });
  });
});
