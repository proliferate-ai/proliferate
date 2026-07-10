/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityChipDescriptor } from "@proliferate/product-domain/activity/chips";
import { ActivityChips } from "./ActivityChips";

afterEach(() => {
  cleanup();
});

const LOOPS_CHIP: ActivityChipDescriptor = {
  kind: "loops",
  count: 2,
  liveCount: 2,
  label: "2 loops",
};

const TERMINALS_CHIP: ActivityChipDescriptor = {
  kind: "terminals",
  count: 1,
  liveCount: 1,
  label: "1 terminal",
};

describe("ActivityChips", () => {
  it("renders nothing when there are no chips", () => {
    const { container } = render(<ActivityChips chips={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a labeled, non-interactive chip when no panel is supplied", () => {
    render(<ActivityChips chips={[LOOPS_CHIP]} />);
    expect(screen.getByText("2 loops")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a clickable trigger when a panel is supplied", () => {
    render(
      <ActivityChips
        chips={[LOOPS_CHIP]}
        panels={{ loops: <div>Loops panel content</div> }}
      />,
    );
    expect(screen.getByRole("button", { name: "2 loops" })).toBeTruthy();
  });

  it("renders one entry per chip with a separator between them", () => {
    render(<ActivityChips chips={[LOOPS_CHIP, TERMINALS_CHIP]} />);
    expect(screen.getByText("2 loops")).toBeTruthy();
    expect(screen.getByText("1 terminal")).toBeTruthy();
  });
});
