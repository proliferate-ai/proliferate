// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApiKeyCreatorModal } from "./ApiKeyCreatorModal";

// Radix Dialog (ModalShell) touches DOM APIs jsdom doesn't implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderModal(overrides: Partial<Parameters<typeof ApiKeyCreatorModal>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <ApiKeyCreatorModal
      open
      onClose={onClose}
      heading="Add API key"
      showTitleField
      submitLabel="Add key"
      submitting={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

describe("ApiKeyCreatorModal", () => {
  it("submits title, value and env var in agent context", () => {
    const { onSubmit } = renderModal({
      envVarField: { label: "Environment variable", initialValue: "ANTHROPIC_API_KEY" },
    });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Work key" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "sk-ant-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Work key",
      value: "sk-ant-123",
      envVarName: "ANTHROPIC_API_KEY",
    });
  });

  it("blocks submit on an invalid SCREAMING_SNAKE_CASE env var", () => {
    const { onSubmit } = renderModal({
      envVarField: { label: "Environment variable", initialValue: "" },
    });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Work key" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "sk-ant-123" } });
    fireEvent.change(screen.getByLabelText("Environment variable"), {
      target: { value: "lower-case" },
    });

    expect(
      screen.getByRole("button", { name: "Add key" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hides the title field and submits name+value in secrets context", () => {
    const { onSubmit } = renderModal({
      showTitleField: false,
      submitLabel: "Save secret",
      envVarField: { label: "Environment variable" },
    });

    expect(screen.queryByLabelText("Title")).toBeNull();
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "shhh" } });
    fireEvent.change(screen.getByLabelText("Environment variable"), {
      target: { value: "API_TOKEN" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save secret" }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "",
      value: "shhh",
      envVarName: "API_TOKEN",
    });
  });
});
