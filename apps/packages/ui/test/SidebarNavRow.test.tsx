// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarNavRow } from "../src/layout/SidebarNavRow";

afterEach(cleanup);

describe("SidebarNavRow", () => {
  it("merges caller classes without dropping base row spacing", () => {
    render(
      <SidebarNavRow
        label="General"
        icon={<span>G</span>}
        onPress={vi.fn()}
        className="!text-sidebar-foreground"
      />,
    );

    const row = screen.getByRole("button", { name: "G General" });
    expect(row.className).toContain("min-h-[calc(1lh+0.5rem)]");
    expect(row.className).toContain("gap-2");
    expect(row.className).toContain("px-2");
    expect(row.className).toContain("!text-sidebar-foreground");
  });
});
