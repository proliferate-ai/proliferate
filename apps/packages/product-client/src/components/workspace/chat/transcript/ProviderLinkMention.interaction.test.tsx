// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { ProviderLinkMention } from "#product/components/workspace/chat/transcript/ProviderLinkMention";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

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
});
