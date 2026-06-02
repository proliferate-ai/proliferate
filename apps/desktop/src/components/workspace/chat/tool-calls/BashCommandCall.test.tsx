// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BashCommandCall } from "./BashCommandCall";

afterEach(() => {
  cleanup();
});

describe("BashCommandCall", () => {

  it("keeps command output hidden until the row is clicked", () => {
    render(
      <BashCommandCall
        command="pnpm test"
        output="test output"
        status="running"
        duration="for 3s"
      />,
    );

    const row = screen.getByRole("button", { name: /Running command pnpm test/i });
    expect(row).toBeTruthy();
    expect(screen.queryByText("test output")).toBeNull();

    fireEvent.click(row);

    expect(screen.getByText("test output")).toBeTruthy();
  });
});
