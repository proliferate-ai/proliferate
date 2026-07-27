// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarNavRow } from "../src/patterns/SidebarNavRow";

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
    expect(row.className).toContain("h-[30px]");
    expect(row.className).toContain("gap-2");
    expect(row.className).toContain("pl-2");
    expect(row.className).toContain("pr-1");
    expect(row.className).toContain("!text-sidebar-foreground");
  });
});
