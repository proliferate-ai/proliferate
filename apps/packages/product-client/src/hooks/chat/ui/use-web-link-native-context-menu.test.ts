import { describe, expect, it, vi } from "vitest";
import { buildWebLinkNativeContextMenuItems } from "#product/hooks/chat/ui/use-web-link-native-context-menu";

describe("buildWebLinkNativeContextMenuItems", () => {
  it("keeps the web-link menu concise and ordered", () => {
    const openInBrowser = vi.fn();
    const copyLink = vi.fn();
    const items = buildWebLinkNativeContextMenuItems({ openInBrowser, copyLink });

    expect(items).toMatchObject([
      { id: "open-in-browser", label: "Open in Browser" },
      { id: "copy-link", label: "Copy link" },
    ]);
    items[0]?.onSelect?.();
    items[1]?.onSelect?.();
    expect(openInBrowser).toHaveBeenCalledOnce();
    expect(copyLink).toHaveBeenCalledOnce();
  });
});
