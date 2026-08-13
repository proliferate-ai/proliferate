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
});
