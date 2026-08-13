// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsGroup } from "#product/primitives/patterns/settings/SettingsGroup";

describe("SettingsGroup", () => {
  it("interleaves one divider between each visible child", () => {
    const { container } = render(
      <SettingsGroup>
        <div>First</div>
        <div>Second</div>
        <div>Third</div>
      </SettingsGroup>,
    );

    const dividers = container.querySelectorAll("[aria-hidden]");
    expect(dividers).toHaveLength(2);
    dividers.forEach((divider) => {
      expect(divider.className).toContain("mx-3.5");
      expect(divider.className).toContain("bg-border-light");
    });
  });

  it("drops null, undefined, and boolean children without leaving an orphan divider", () => {
    const { container } = render(
      <SettingsGroup>
        <div>First</div>
        {null}
        {false}
        {undefined}
        <div>Second</div>
      </SettingsGroup>,
    );

    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(1);
  });

  it("renders the empty slot inside the frame when there are no children", () => {
    const { container, getByText } = render(
      <SettingsGroup empty="No results">
        {null}
      </SettingsGroup>,
    );

    expect(getByText("No results")).toBeTruthy();
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(0);
    const card = container.firstElementChild;
    expect(card?.className).toContain("rounded-xl");
    expect(card?.className).toContain("bg-surface-elevated-secondary");
  });

  it("renders nothing extra when there are no children and no empty slot", () => {
    const { container } = render(<SettingsGroup>{null}</SettingsGroup>);

    const card = container.firstElementChild;
    expect(card?.textContent).toBe("");
  });

  it("renders the label above the card", () => {
    const { getByText } = render(
      <SettingsGroup label="Section label">
        <div>Row</div>
      </SettingsGroup>,
    );

    const label = getByText("Section label");
    expect(label.className).toContain("text-ui-sm");
    expect(label.className).toContain("text-muted-foreground");
  });
});
