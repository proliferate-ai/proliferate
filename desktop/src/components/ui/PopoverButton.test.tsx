/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";

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

describe("PopoverButton", () => {
  it("honors an external close after the trigger opened the popover", async () => {
    render(<ControlledPopoverHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expect(screen.getByText("Workspace move details")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Force close" }));

    await waitFor(() => {
      expect(screen.queryByText("Workspace move details")).toBeNull();
    });
  });
});
