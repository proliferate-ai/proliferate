// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddCustomIntegrationDialog } from "./AddCustomIntegrationDialog";

function renderDialog(
  overrides: Partial<Parameters<typeof AddCustomIntegrationDialog>[0]> = {},
) {
  return render(
    <AddCustomIntegrationDialog
      open
      creating={false}
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Internal tools" },
  });
  fireEvent.change(screen.getByLabelText("Namespace"), {
    target: { value: "internal-tools" },
  });
  fireEvent.change(screen.getByLabelText("MCP URL"), {
    target: { value: "https://mcp.example.com/mcp" },
  });
}

describe("AddCustomIntegrationDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("defaults authentication to auto-detect and explains the model", () => {
    renderDialog();

    const select = screen.getByLabelText("Authentication") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    expect(
      screen.getByText(/Auto-detect probes the server when you add it/),
    ).toBeTruthy();
  });

  it("submits the chosen auth kind with the form values", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSubmit });

    fillValidForm();
    fireEvent.change(screen.getByLabelText("Authentication"), {
      target: { value: "oauth2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add integration" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      displayName: "Internal tools",
      namespace: "internal-tools",
      mcpUrl: "https://mcp.example.com/mcp",
      authKind: "oauth2",
    });
  });

  it("keeps invalid forms local and never submits", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSubmit });

    fireEvent.click(screen.getByRole("button", { name: "Add integration" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Display name is required.")).toBeTruthy();
  });

  it("surfaces a rejected submit inline", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("boom"));
    renderDialog({ onSubmit });

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Add integration" }));

    expect(
      await screen.findByText("The custom integration could not be added. Try again."),
    ).toBeTruthy();
  });
});
