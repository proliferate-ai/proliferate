// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionRow } from "#product/primitives/patterns/ActionRow";

afterEach(() => {
  cleanup();
});

describe("ActionRow", () => {
  it("washes on hover with no selection to derive it from", () => {
    // The whole reason this pattern exists beside `RosterRow`: the row is not
    // pressable and still says which row the controls belong to.
    const { container } = render(<ActionRow title="Parked run" actions={<button>Resume</button>} />);

    const row = container.firstElementChild;
    expect(row?.className).toContain("hover:bg-hover");
    expect(row?.getAttribute("role")).toBeNull();
    expect(row?.getAttribute("tabindex")).toBeNull();
  });

  it("tones the secondary line for a second line that is itself the failure", () => {
    render(
      <ActionRow
        title="Update the parser"
        secondary="Not sent · Session creation failed."
        secondaryTone="destructive"
        actions={<button>Retry</button>}
      />,
    );

    expect(screen.getByText("Not sent · Session creation failed.").className)
      .toContain("text-destructive/80");
  });

  it("defaults the secondary line to the muted tone", () => {
    render(<ActionRow title="Parked run" secondary="Interrupted 2h ago" actions={null} />);

    expect(screen.getByText("Interrupted 2h ago").className).toContain("text-muted-foreground");
  });

  it("derives alignment from the presence of a secondary line, not from a prop", () => {
    const { container: twoLine } = render(
      <ActionRow title="Parked run" secondary="Interrupted 2h ago" actions={null} />,
    );
    expect(twoLine.firstElementChild?.className).toContain("items-start");

    cleanup();

    const { container: oneLine } = render(<ActionRow title="Parked run" actions={null} />);
    expect(oneLine.firstElementChild?.className).toContain("items-center");
  });

  it("hangs native tooltips off the truncating lines themselves", () => {
    render(
      <ActionRow
        title="A title too long to fit"
        titleTooltip="A title too long to fit"
        secondary="Not sent · boom"
        secondaryTooltip="boom"
        actions={null}
      />,
    );

    expect(screen.getByText("A title too long to fit").getAttribute("title"))
      .toBe("A title too long to fit");
    expect(screen.getByText("Not sent · boom").getAttribute("title")).toBe("boom");
  });
});
