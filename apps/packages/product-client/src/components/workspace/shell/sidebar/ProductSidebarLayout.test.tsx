/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductSidebarFrame } from "#product/components/workspace/shell/sidebar/ProductSidebarLayout";

describe("ProductSidebarFrame", () => {
  afterEach(() => {
    cleanup();
  });

  it("paints its own opaque sidebar background by default", () => {
    const { container } = render(
      <ProductSidebarFrame>
        <span>content</span>
      </ProductSidebarFrame>,
    );
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.classList.contains("bg-sidebar")).toBe(true);
    expect(frame.classList.contains("bg-transparent")).toBe(false);
  });

  it("cedes the background to the shell panel when glassBackground is set", () => {
    const { container } = render(
      <ProductSidebarFrame glassBackground>
        <span>content</span>
      </ProductSidebarFrame>,
    );
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.classList.contains("bg-transparent")).toBe(true);
    expect(frame.classList.contains("bg-sidebar")).toBe(false);
  });
});
