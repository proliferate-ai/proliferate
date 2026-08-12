// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Disclosure } from "#product/primitives/patterns/Disclosure";

afterEach(cleanup);

function ControlledDisclosure({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <Disclosure open={open} onOpenChange={setOpen} title="Grouped rows">
      <p>panel body</p>
    </Disclosure>
  );
}

describe("Disclosure", () => {
  it("toggles from the keyboard and keeps aria-expanded in step", async () => {
    const user = userEvent.setup();
    render(<ControlledDisclosure />);

    const toggle = screen.getByRole("button", { name: "Grouped rows" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // A real <button> is what makes Enter and Space work without a
    // hand-rolled onKeyDown, so both keys are asserted.
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("points aria-controls at the region the header labels", () => {
    render(<ControlledDisclosure initial />);

    const toggle = screen.getByRole("button", { name: "Grouped rows" });
    const region = screen.getByRole("region", { name: "Grouped rows" });
    expect(toggle.getAttribute("aria-controls")).toBe(region.id);
    expect(region.getAttribute("aria-labelledby")).toBe(toggle.id);
  });

  it("keeps the collapsed region inert so hidden content cannot take focus", () => {
    const { container } = render(<ControlledDisclosure />);

    const collapsible = container.querySelector("[data-animated-collapsible-content]");
    expect(collapsible?.getAttribute("data-expanded")).toBe("false");
    expect(collapsible?.hasAttribute("inert")).toBe(true);
    expect(collapsible?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not toggle while disabled", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Disclosure open={false} onOpenChange={onOpenChange} disabled title="Disabled">
        <p>panel body</p>
      </Disclosure>,
    );

    await user.click(screen.getByRole("button", { name: "Disabled" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("owns the row state stack from the shared state tokens", () => {
    const { container } = render(<ControlledDisclosure />);

    const row = container.querySelector("[aria-expanded]")?.parentElement;
    expect(row?.className).toContain("hover:bg-hover");
    expect(row?.className).toContain("active:bg-active");
    expect(
      container.querySelector("[aria-expanded]")?.className,
    ).toContain("focus-visible:outline-ring");
  });
});
