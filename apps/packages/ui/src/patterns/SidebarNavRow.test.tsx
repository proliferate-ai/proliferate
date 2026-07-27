// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNavRow } from "./SidebarNavRow";

afterEach(cleanup);

describe("SidebarNavRow", () => {
  it("uses the shared primary sidebar icon size for its well and glyph", () => {
    const { container } = render(
      <SidebarNavRow
        label="New chat"
        icon={<svg data-testid="nav-icon" />}
        onPress={vi.fn()}
      />,
    );

    const icon = container.querySelector('[data-testid="nav-icon"]');
    const well = icon?.parentElement;
    expect(well?.className).toContain("w-[var(--icon-paired)]");
    expect(well?.className).toContain("[&>svg]:icon-paired");
  });
});
