// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelTable, type ModelTableRow } from "./ModelTable";

function row(overrides: Partial<ModelTableRow> = {}): ModelTableRow {
  return {
    id: "claude-sonnet-4-5",
    displayName: "Sonnet 4.6",
    provider: "anthropic",
    effort: { values: ["low", "medium", "high"], default: "medium" },
    fastMode: true,
    status: "active",
    enabled: true,
    ...overrides,
  };
}

describe("ModelTable", () => {
  afterEach(cleanup);

  it("renders the enriched columns: name, monospace id, provider, chips, fast mode, status", () => {
    render(<ModelTable models={[row()]} onToggle={vi.fn()} />);

    expect(screen.getByText("Sonnet 4.6")).toBeTruthy();
    // The id is shown in a dim monospace line beneath the display name.
    expect(screen.getByText("claude-sonnet-4-5")).toBeTruthy();
    expect(screen.getByText("anthropic")).toBeTruthy();
    expect(screen.getByText("low")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("highlights the default effort chip via data-default", () => {
    render(<ModelTable models={[row()]} onToggle={vi.fn()} />);

    expect(screen.getByText("medium").getAttribute("data-default")).toBe("true");
    expect(screen.getByText("low").getAttribute("data-default")).toBeNull();
  });

  it("renders sparse probe-only rows with dashes and no duplicate id line", () => {
    render(
      <ModelTable
        models={[
          {
            id: "mystery-model",
            displayName: "mystery-model",
            provider: null,
            effort: null,
            fastMode: null,
            status: null,
            enabled: true,
          },
        ]}
        onToggle={vi.fn()}
      />,
    );

    // displayName === id → the id renders exactly once (as the name).
    expect(screen.getAllByText("mystery-model")).toHaveLength(1);
    // Provider, Thinking, Fast mode, Status all collapse to em-dashes.
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("renders a Fast mode 'Off' badge when the control is known-absent", () => {
    render(<ModelTable models={[row({ fastMode: false })]} onToggle={vi.fn()} />);

    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.queryByText("On")).toBeNull();
  });

  it("fires onToggle with the model id and the next enabled value", () => {
    const onToggle = vi.fn();
    render(<ModelTable models={[row({ enabled: true })]} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("switch"));

    expect(onToggle).toHaveBeenCalledWith("claude-sonnet-4-5", false);
  });

  it("disables the switch for read-only (runtime-resolved) rows", () => {
    render(
      <ModelTable models={[row({ toggleDisabled: true })]} onToggle={vi.fn()} />,
    );

    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders one switch per model row", () => {
    render(
      <ModelTable
        models={[row({ id: "a", displayName: "A" }), row({ id: "b", displayName: "B" })]}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("switch")).toHaveLength(2);
    const [firstRow] = screen.getAllByRole("row").slice(1);
    expect(within(firstRow).getByText("A")).toBeTruthy();
  });
});
