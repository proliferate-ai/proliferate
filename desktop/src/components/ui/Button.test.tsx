// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/Button";

afterEach(cleanup);

describe("Button", () => {
  it("uses the shared compact spinner while loading", () => {
    render(<Button loading>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button.querySelector("[data-loading-spinner]")).toBeTruthy();
    expect(button.querySelector("svg.animate-spin")).toBeNull();
  });
});
