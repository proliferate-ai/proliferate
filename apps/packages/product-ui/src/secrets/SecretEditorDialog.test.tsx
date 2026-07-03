/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SecretEditorDialog, type SecretEditorDialogState } from "./SecretEditorDialog";

// Radix (Dialog + Popover) touches a few DOM APIs jsdom doesn't implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CREATE_ENV: SecretEditorDialogState = { mode: "create", kind: "env" };

function renderDialog(overrides: Partial<Parameters<typeof SecretEditorDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <SecretEditorDialog
      open
      state={CREATE_ENV}
      filePathMode="absolute"
      onSave={onSave}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSave, onClose };
}

describe("SecretEditorDialog", () => {
  it("renders the type selector as our popover menu (no native <select>)", async () => {
    renderDialog();

    // Trigger reflects the current kind and is a button, not a native <select>.
    const trigger = screen.getByRole("button", { name: /Environment variable/ });
    expect(document.querySelector("select")).toBeNull();

    // Opening it surfaces the styled popover menu with the other option.
    fireEvent.click(trigger);
    const fileOption = await screen.findByRole("button", { name: /^File$/ });

    // Choosing "File" switches the form to the file flow (segmented source control).
    fireEvent.click(fileOption);
    await waitFor(() => {
      expect(screen.getByText("Content source")).toBeTruthy();
    });
    expect(screen.getByRole("radio", { name: /Paste text/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Upload file/ })).toBeTruthy();
    // Still no native select anywhere in the dialog.
    expect(document.querySelector("select")).toBeNull();
  });

  it("flags a duplicate key and blocks save", () => {
    renderDialog({ existingEnvKeys: ["API_TOKEN"] });

    const name = screen.getByLabelText("Variable name");
    fireEvent.change(name, { target: { value: "API_TOKEN" } });
    fireEvent.blur(name);

    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add secret" })).toHaveProperty("disabled", true);
  });

  it("surfaces an empty-key error only after the field is touched", () => {
    renderDialog();

    expect(screen.queryByText("Enter a variable name.")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Variable name"));
    expect(screen.getByText("Enter a variable name.")).toBeTruthy();
  });
});
