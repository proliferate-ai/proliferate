// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudChatComposer } from "../src/chat/CloudChatComposer";

describe("CloudChatComposer", () => {
  afterEach(cleanup);

  it("uses the shared composer surface and submits through the textarea", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <CloudChatComposer
        composer={{
          value: "hello",
          placeholder: "Send a prompt",
          canSubmit: true,
          onChange,
          onSubmit,
          controls: [],
        }}
      />,
    );

    const composerSurface = document.querySelector("[data-chat-composer-surface]");
    expect(composerSurface).toBeTruthy();

    const textarea = screen.getByPlaceholderText("Send a prompt");
    fireEvent.change(textarea, { target: { value: "next" } });
    expect(onChange).toHaveBeenCalledWith("next");

    fireEvent.keyDown(textarea, {
      key: "Enter",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      nativeEvent: { isComposing: false },
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("opens shared composer control popovers", () => {
    const onSelect = vi.fn();

    render(
      <CloudChatComposer
        composer={{
          value: "",
          placeholder: "Send a prompt",
          canSubmit: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          controls: [
            {
              id: "agent",
              label: "Agent",
              icon: "bot",
              placement: "leading",
              groups: [
                {
                  id: "agents",
                  options: [
                    { id: "claude", label: "Claude", selected: true },
                    { id: "gemini", label: "Gemini" },
                  ],
                },
              ],
              onSelect,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Agent: Claude" }));
    fireEvent.click(screen.getByText("Gemini"));

    expect(onSelect).toHaveBeenCalledWith("gemini");
  });

  it("shows every agent model group directly in the model menu", () => {
    const onSelect = vi.fn();

    render(
      <CloudChatComposer
        composer={{
          value: "",
          placeholder: "Send a prompt",
          canSubmit: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          controls: [
            {
              id: "model",
              key: "model",
              label: "Model",
              icon: "claude",
              placement: "trailing",
              groups: [
                {
                  id: "claude",
                  label: "Claude",
                  options: [{ id: "claude:sonnet", label: "Sonnet 4.6", selected: true }],
                },
                {
                  id: "codex",
                  label: "Codex",
                  options: [{ id: "codex:gpt-5.4", label: "GPT-5.4" }],
                },
              ],
              onSelect,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Model and configuration: Sonnet 4.6" }));

    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "GPT-5.4" }));
    expect(onSelect).toHaveBeenCalledWith("codex:gpt-5.4");
  });
});
