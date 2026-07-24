// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowActionIconButton, RowActionIndicator } from "./RowActionIconButton";

afterEach(cleanup);

describe("RowActionIconButton", () => {
  it("owns the sanctioned box, glyph, state, and reveal classes", () => {
    const { getByRole } = render(
      <RowActionIconButton label="Open action">
        <svg />
      </RowActionIconButton>,
    );
    const button = getByRole("button", { name: "Open action" });

    expect(button.className).toContain("size-7");
    expect(button.className).toContain("!p-0");
    expect(button.className).toContain("rounded-md");
    expect(button.className).toContain("text-ui");
    expect(button.className).toContain("[&_svg]:icon-control");
    expect(button.className).toContain("hover:bg-hover");
    expect(button.className).toContain("active:bg-active");
    expect(button.className).toContain("data-[state=open]:bg-active");
    expect(button.className).toContain("pointer-events-none");
    expect(button.className).toContain("group-hover:pointer-events-auto");
    expect(button.className).toContain("group-focus-within:pointer-events-auto");
    expect(button.className).toContain("focus-visible:pointer-events-auto");
    expect(button.className).toContain("data-[state=open]:pointer-events-auto");
    expect(button.className).toContain("disabled:!pointer-events-none");
  });

  it("is pointer-active and visible when visibility is always", () => {
    const { getByRole } = render(
      <RowActionIconButton label="Always visible" visibility="always">
        <svg />
      </RowActionIconButton>,
    );
    const button = getByRole("button", { name: "Always visible" });

    expect(button.className).toContain("pointer-events-auto");
    expect(button.className).toContain("opacity-100");
    expect(button.className).not.toContain("group-hover:pointer-events-auto");
  });

  it("forwards its measurable ref, label, title, state, and disabled semantics", () => {
    const ref = createRef<HTMLButtonElement>();
    const { getByRole } = render(
      <RowActionIconButton ref={ref} label="Measured action" active disabled>
        <svg />
      </RowActionIconButton>,
    );
    const button = getByRole("button", { name: "Measured action" });

    expect(ref.current).toBe(button);
    const measure = vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      width: 28,
      height: 28,
      top: 20,
      right: 38,
      bottom: 48,
      left: 10,
      toJSON: () => ({}),
    });
    expect(ref.current?.getBoundingClientRect().width).toBe(28);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("title")).toBe("Measured action");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-active")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops row propagation before invoking its callback", () => {
    const rowClick = vi.fn();
    const actionClick = vi.fn();
    const { getByRole } = render(
      <div onClick={rowClick}>
        <RowActionIconButton label="Nested action" onClick={actionClick}>
          <svg />
        </RowActionIconButton>
      </div>,
    );

    fireEvent.click(getByRole("button", { name: "Nested action" }));
    expect(actionClick).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("provides a non-interactive companion with the same box and reveal", () => {
    const { container } = render(
      <RowActionIndicator>
        <svg />
      </RowActionIndicator>,
    );
    const indicator = container.querySelector("span");

    expect(indicator?.className).toContain("size-7");
    expect(indicator?.className).toContain("[&_svg]:icon-control");
    expect(indicator?.className).toContain("pointer-events-none");
    expect(indicator?.className).toContain("group-hover:opacity-100");
    expect(indicator?.getAttribute("aria-hidden")).not.toBeNull();
  });
});
