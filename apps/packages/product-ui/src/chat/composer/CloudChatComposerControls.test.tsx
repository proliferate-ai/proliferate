/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudChatComposerControlRow } from "./CloudChatComposerControls";

afterEach(cleanup);

describe("CloudChatComposerControlRow icon tiers", () => {
  it("promotes primary input actions while keeping labeled control glyphs paired", () => {
    const { container } = render(
      <CloudChatComposerControlRow
        composer={{
          value: "",
          placeholder: "Ask anything",
          canSubmit: true,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          controls: [{
            id: "mode",
            label: "Mode",
            placement: "leading",
            icon: "plan",
            groups: [{
              id: "mode-options",
              options: [{ id: "plan", label: "Plan", selected: true, icon: "plan" }],
            }],
          }, {
            id: "model",
            key: "model",
            label: "Model",
            placement: "trailing",
            icon: "claude",
            groups: [{
              id: "models",
              options: [{ id: "sonnet", label: "Sonnet", selected: true, icon: "claude" }],
            }],
          }],
        }}
      />,
    );

    const addIcon = screen.getByRole("button", { name: "Add context" }).querySelector("svg");
    const sendIcon = screen.getByRole("button", { name: "Send message" }).querySelector("svg");
    const modelIcon = screen
      .getByRole("button", { name: "Model and configuration: Sonnet" })
      .querySelector("svg");
    expect(addIcon?.getAttribute("class")?.split(" ")).toContain("icon-control");
    expect(sendIcon?.getAttribute("class")?.split(" ")).toContain("icon-control");
    expect(modelIcon?.getAttribute("class")?.split(" ")).toContain("icon-paired");
    expect(container.querySelector("svg.icon-paired")).not.toBeNull();
  });
});
