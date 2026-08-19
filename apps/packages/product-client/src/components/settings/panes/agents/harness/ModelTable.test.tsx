// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ModelTable } from "./ModelTable";

it("renders a read-only observed inventory", () => {
  render(<ModelTable models={[{
    id: "unknown-id",
    displayName: "Observed name",
    description: "Observed description",
  }]} />);
  expect(screen.getByText("Observed name")).toBeTruthy();
  expect(screen.getByText("Observed description")).toBeTruthy();
  expect(screen.queryByRole("switch")).toBeNull();
});
