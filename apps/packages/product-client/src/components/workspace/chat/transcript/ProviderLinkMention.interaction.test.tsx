// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { ProviderLinkMention } from "#product/components/workspace/chat/transcript/ProviderLinkMention";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

afterEach(cleanup);

function renderMention(host: ReturnType<typeof makeTestProductHost>) {
  render(
    <ProductHostProvider host={host}>
      <ProviderLinkMention href="https://example.com/docs">docs</ProviderLinkMention>
    </ProductHostProvider>,
  );
  return screen.getByRole("link", { name: "docs" });
}

describe("ProviderLinkMention interactions", () => {
  it("opens on primary click and exposes the shared DOM context menu", () => {
    const openExternal = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    const host = makeTestProductHost({ desktop: null });
    host.links.openExternal = openExternal;
    host.clipboard.writeText = writeText;

    render(
      <ProductHostProvider host={host}>
        <ProviderLinkMention href="https://example.com/docs">docs</ProviderLinkMention>
      </ProductHostProvider>,
    );

    const link = screen.getByRole("link", { name: "docs" });
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");

    fireEvent.contextMenu(link);
    expect(screen.getByRole("menu", { name: "Link actions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("keeps a real target/rel anchor as the native fallback", () => {
    const link = renderMention(makeTestProductHost({ desktop: null }));

    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("leaves modified and non-primary clicks to the browser", () => {
    const openExternal = vi.fn(async () => undefined);
    const host = makeTestProductHost({ desktop: null });
    host.links.openExternal = openExternal;
    const link = renderMention(host);

    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifier });
      link.dispatchEvent(event);
      // Not intercepted: the anchor's own target/rel handles the open, which
      // is what preserves background-tab and new-window behavior.
      expect(event.defaultPrevented).toBe(false);
    }

    expect(openExternal).not.toHaveBeenCalled();
  });

  it("falls back to a noopener window open when the host opener rejects", async () => {
    const openExternal = vi.fn(async () => {
      throw new Error("no opener available");
    });
    const windowOpen = vi.fn();
    vi.stubGlobal("open", windowOpen);
    const host = makeTestProductHost({ desktop: null });
    host.links.openExternal = openExternal;
    const link = renderMention(host);

    fireEvent.click(link);
    await vi.waitFor(() => expect(windowOpen).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    ));

    vi.unstubAllGlobals();
  });
});
