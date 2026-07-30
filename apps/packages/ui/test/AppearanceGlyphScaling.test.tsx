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
import { ProviderIcon } from "../src/icons/provider-icons";
import { twMerge } from "../src/utils/tw-merge";
import { SidebarActionButton } from "../src/patterns/SidebarActionButton";

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

  it("takes its box from the shared control-height tier, not an arbitrary height", () => {
    const { getByRole } = render(
      <SegmentedControl
        items={[{ id: "one", label: "One" }]}
        value="one"
        onChange={() => undefined}
      />,
    );

    const item = getByRole("radio", { name: "One" });
    expect(item.className).toContain("h-control");
    expect(item.className).not.toContain("h-[30px]");
  });

  it("puts an incoming className on the group, not on the height-bearing segments", () => {
    // Load-bearing for consumers that must depart from the control tier (a
    // segmented control inside a form stack of 36px inputs): a plain `h-9` in
    // `className` lands on the wrapper and never reaches the buttons, so such a
    // callsite has to use a child variant. Documented as a test so the next
    // person overriding the height does not discover it visually.
    const { getByRole } = render(
      <SegmentedControl
        className="h-9"
        items={[{ id: "one", label: "One" }]}
        value="one"
        onChange={() => undefined}
      />,
    );

    const group = getByRole("radiogroup");
    const item = getByRole("radio", { name: "One" });
    expect(group.className).toContain("h-9");
    expect(item.className).not.toContain("h-9");
    expect(item.className).toContain("h-control");
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
    // Round-4: the wrapper's own [&_svg]:icon-tight is what actually reaches
    // the child glyph — it wins the same twMerge icon-size group as the base
    // RowActionIconButton's [&_svg]:icon-control descendant selector, which
    // otherwise beats any plain size class a caller puts on the child SVG
    // directly (that's why the glyph rendered at 16px regardless of the
    // "icon-compact" class below).
    expect(button.className).toContain("[&_svg]:icon-tight");
    expect(button.querySelector("svg")?.className.baseVal).toContain("icon-compact");
  });

  it("lets a caller replace one semantic optical tier with another", () => {
    expect(twMerge("icon-compact", "icon-control")).toBe("icon-control");
  });
});
