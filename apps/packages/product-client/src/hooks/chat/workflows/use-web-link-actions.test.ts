// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWebLinkActions } from "#product/hooks/chat/workflows/use-web-link-actions";

const host = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  writeText: vi.fn(async () => undefined),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    links: { openExternal: host.openExternal },
    clipboard: { writeText: host.writeText },
  }),
}));

describe("useWebLinkActions", () => {
  it("normalizes once and routes open and copy through the host", async () => {
    const { result } = renderHook(() => useWebLinkActions("www.example.com/docs"));

    expect(result.current.normalizedHref).toBe("https://www.example.com/docs");
    await act(async () => {
      await result.current.openInBrowser();
      await result.current.copyLink();
    });

    expect(host.openExternal).toHaveBeenCalledWith("https://www.example.com/docs");
    expect(host.writeText).toHaveBeenCalledWith("https://www.example.com/docs");
  });
});
