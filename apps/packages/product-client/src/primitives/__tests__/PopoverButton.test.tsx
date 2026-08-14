/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Button } from "#product/primitives/Button";
import { PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";

afterEach(() => {
  cleanup();
});

function ControlledPopoverHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <PopoverButton
        externalOpen={open}
        onOpenChange={setOpen}
        trigger={<Button variant="ghost">Location</Button>}
      >
        {() => <div>Workspace move details</div>}
      </PopoverButton>
      <Button
        variant="ghost"
        onClick={() => setOpen(false)}
      >
        Force close
      </Button>
    </>
  );
}

function SearchPopoverHarness() {
  const [search, setSearch] = useState("");

  return (
    <PopoverButton trigger={<Button variant="ghost">Choose project</Button>}>
      {() => (
        <PopoverSearchField
          value={search}
          onChange={setSearch}
          placeholder="Search projects"
        />
      )}
    </PopoverButton>
  );
}

describe("PopoverButton", () => {
  it("focuses a picker search field when the popover opens", async () => {
    render(<SearchPopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Choose project" }));
    const search = screen.getByPlaceholderText("Search projects");

    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it("honors an external close after the trigger opened the popover", async () => {
    render(<ControlledPopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expect(screen.getByText("Workspace move details")).toBeTruthy();

    // The popover is modal (outside-click shield), so content outside it is
    // aria-hidden while open — query with hidden to reach the external button.
    fireEvent.click(screen.getByRole("button", { name: "Force close", hidden: true }));

    await waitFor(() => {
      expect(screen.queryByText("Workspace move details")).toBeNull();
    });
  });

  it("scopes the enter animation to the open state so Presence can unmount the closed content", () => {
    // A bare `animate-popover-in` leaves the animation declared on the closed
    // element; Radix Presence reads any non-`none` animation name as a running
    // exit animation and waits for an `animationend` that already fired, so the
    // closed popover stays painted. jsdom computes no Tailwind styles, so the
    // contract is asserted on the class the content actually wears.
    render(<ControlledPopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    const content = document.querySelector("[data-slot=popover-content]");

    expect(content?.className).toContain("data-[state=open]:animate-popover-in");
    expect(content?.className).not.toMatch(/(^|\s)animate-popover-in(\s|$)/);
  });
});
