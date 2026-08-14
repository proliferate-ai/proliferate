// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebLinkMenu } from "#product/components/workspace/chat/transcript/WebLinkMenu";

describe("WebLinkMenu", () => {
  it("offers the exact web-link actions in order", () => {
    const close = vi.fn();
    const onOpen = vi.fn();
    const onCopy = vi.fn();
    render(<WebLinkMenu close={close} onOpen={onOpen} onCopy={onCopy} />);

    expect(screen.getByRole("menu", { name: "Link actions" })).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open in Browser",
      "Copy link",
    ]);

    fireEvent.click(items[0]!);
    fireEvent.click(items[1]!);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(2);
  });
});
