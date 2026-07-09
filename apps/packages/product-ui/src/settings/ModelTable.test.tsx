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
    modes: ["ask", "code"],
    fastMode: true,
    status: "active",
    enabled: true,
    ...overrides,
  };
}

describe("ModelTable", () => {
  afterEach(cleanup);

  it("renders the enriched columns: name, monospace id, provider, chips, modes, fast mode", () => {
    render(<ModelTable models={[row()]} onToggle={vi.fn()} />);

    expect(screen.getByText("Sonnet 4.6")).toBeTruthy();
    // The id is shown in a dim monospace line beneath the display name.
    expect(screen.getByText("claude-sonnet-4-5")).toBeTruthy();
    expect(screen.getByText("anthropic")).toBeTruthy();
    expect(screen.getByText("low")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    // Modes render as quiet pills.
    expect(screen.getByText("ask")).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("renders modes plainly (no overflow pill) when there are three or fewer", () => {
    render(<ModelTable models={[row({ modes: ["ask", "code", "architect"] })]} onToggle={vi.fn()} />);

    expect(screen.getByText("ask")).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("architect")).toBeTruthy();
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    expect(screen.getByLabelText("Modes").getAttribute("title")).toBe("ask, code, architect");
  });

  it("collapses modes beyond three into a '+N' overflow pill with a full-list title", () => {
    const sixModes = ["ask", "code", "architect", "debug", "orchestrator", "review"];
    render(<ModelTable models={[row({ modes: sixModes })]} onToggle={vi.fn()} />);

    // Only the first three render as individual pills.
    expect(screen.getByText("ask")).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("architect")).toBeTruthy();
    expect(screen.queryByText("debug")).toBeNull();
    expect(screen.queryByText("orchestrator")).toBeNull();
    expect(screen.queryByText("review")).toBeNull();

    // The overflow pill summarizes the rest.
    expect(screen.getByText("+3")).toBeTruthy();

    // The cell's title attribute lists every mode, comma-separated.
    expect(screen.getByLabelText("Modes").getAttribute("title")).toBe(sixModes.join(", "));
  });

  it("does not render the (dropped) Status column", () => {
    render(<ModelTable models={[row({ status: "active" })]} onToggle={vi.fn()} />);

    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("highlights the default effort chip via data-default", () => {
    render(<ModelTable models={[row()]} onToggle={vi.fn()} />);

    expect(screen.getByText("medium").getAttribute("data-default")).toBe("true");
    expect(screen.getByText("low").getAttribute("data-default")).toBeNull();
  });

  it("renders the description as the subtitle and moves the id to a hover title", () => {
    render(
      <ModelTable
        models={[row({ description: "Balanced everyday model" })]}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Balanced everyday model")).toBeTruthy();
    // With a description present, the id is no longer a visible subtitle line…
    expect(screen.queryByText("claude-sonnet-4-5")).toBeNull();
    // …it moves to the name block's title attribute.
    expect(screen.getByText("Sonnet 4.6").getAttribute("title")).toBe(
      "claude-sonnet-4-5",
    );
  });

  it("falls back to the id subtitle (no title) when no description is present", () => {
    render(<ModelTable models={[row({ description: null })]} onToggle={vi.fn()} />);

    expect(screen.getByText("claude-sonnet-4-5")).toBeTruthy();
    expect(screen.getByText("Sonnet 4.6").getAttribute("title")).toBeNull();
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
            modes: null,
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
    // Provider, Thinking, Modes, Fast mode all collapse to em-dashes.
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
