// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudChatComposer } from "../src/chat/CloudChatComposer";

describe("CloudChatComposer", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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

  it("shows copied feedback for footer copy controls", async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockResolvedValue(true);

    render(
      <CloudChatComposer
        composer={{
          value: "",
          placeholder: "Send a prompt",
          canSubmit: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          controls: [],
          footerControls: [
            {
              id: "copy-branch",
              label: "feature/loading",
              detail: "Branch",
              icon: "branch",
              feedback: "copied",
              title: "Copy branch name",
              onClick: onCopy,
            },
          ],
        }}
      />,
    );

    const copyButton = screen.getByTitle("Copy branch name");
    expect(copyButton.querySelector(".lucide-git-branch")).toBeTruthy();
    fireEvent.click(copyButton);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(copyButton.title).toBe("Copied");
    expect(screen.getByRole("button", { name: "Copied branch name" })).toBe(copyButton);
    expect(screen.getByText("Copied branch name")).toBeTruthy();
    expect(copyButton.querySelector(".lucide-check")).toBeTruthy();
    expect(copyButton.querySelector(".lucide-git-branch")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(copyButton.title).toBe("Copy branch name");
    expect(copyButton.querySelector(".lucide-git-branch")).toBeTruthy();
  });

  it("does not show copied feedback when footer copy controls report failure", async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockResolvedValue(false);

    render(
      <CloudChatComposer
        composer={{
          value: "",
          placeholder: "Send a prompt",
          canSubmit: false,
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          controls: [],
          footerControls: [
            {
              id: "copy-repo",
              label: "proliferate-ai/proliferate",
              detail: "Repo",
              icon: "repo",
              feedback: "copied",
              title: "Copy repository name",
              onClick: onCopy,
            },
          ],
        }}
      />,
    );

    const copyButton = screen.getByTitle("Copy repository name");
    fireEvent.click(copyButton);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(copyButton.title).toBe("Copy repository name");
    expect(copyButton.querySelector(".lucide-check")).toBeNull();
    expect(screen.queryByText("Copied repository name")).toBeNull();
  });
});
