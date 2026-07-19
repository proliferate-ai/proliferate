// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CheckCircleFilled } from "../src/icons/status";
import {
  FolderFilled,
  FolderPlusFilled,
  InlinePathMentionIcon,
} from "../src/icons/workspace";
import { SegmentedControl } from "../src/primitives/SegmentedControl";
import { ProviderIcon } from "../src/provider-icons";
import { twMerge } from "../src/utils/tw-merge";
import { SidebarActionButton } from "../src/layout/SidebarActionButton";

afterEach(cleanup);

describe("appearance-owned glyph sizing", () => {
  it("uses semantic optical tiers for reusable SVG defaults", () => {
    const { container } = render(
      <>
        <CheckCircleFilled data-testid="status" />
        <InlinePathMentionIcon data-testid="inline" />
        <FolderFilled data-testid="paired" />
        <FolderPlusFilled data-testid="control" />
      </>,
    );

    expect(container.querySelector('[data-testid="status"]')?.getAttribute("width"))
      .toBe("var(--icon-large)");
    expect(container.querySelector('[data-testid="inline"]')?.getAttribute("width"))
      .toBe("var(--icon-compact)");
    expect(container.querySelector('[data-testid="paired"]')?.getAttribute("width"))
      .toBe("var(--icon-paired)");
    expect(container.querySelector('[data-testid="control"]')?.getAttribute("width"))
      .toBe("var(--icon-control)");
  });

  it("defaults provider glyphs to the paired label tier", () => {
    const { container } = render(<ProviderIcon kind="codex" />);

    expect(container.querySelector("svg")?.className.baseVal)
      .toContain("icon-paired");
  });

  it("pairs a control glyph with its semantic label owner", () => {
    const { getByRole } = render(
      <SegmentedControl
        items={[{ id: "one", label: "One", icon: <svg aria-hidden /> }]}
        value="one"
        onChange={() => undefined}
      />,
    );

    const item = getByRole("radio", { name: "One" });
    expect(item.className).toContain("text-ui");
    expect(item.className).toContain("[&_svg]:icon-paired");
  });

  it("scales sidebar action glyphs without scaling their pointer target", () => {
    const { getByRole } = render(
      <SidebarActionButton title="Add repository">
        <svg className="icon-compact" aria-hidden />
      </SidebarActionButton>,
    );

    const button = getByRole("button", { name: "Add repository" });
    expect(button.className).toContain("[font-size:var(--text-sidebar-row)]");
    expect(button.className).toContain("size-6");
    expect(button.querySelector("svg")?.className.baseVal).toContain("icon-compact");
  });

  it("lets a caller replace one semantic optical tier with another", () => {
    expect(twMerge("icon-compact", "icon-control")).toBe("icon-control");
  });
});
