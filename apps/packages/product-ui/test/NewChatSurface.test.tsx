// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewChatSurface } from "../src/new-chat/NewChatSurface";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "../src/chat/ChatColumn";

const target = {
  label: "Target",
  groups: [
    {
      id: "targets",
      items: [
        { id: "shared", label: "Organization cloud", selected: true },
        { id: "personal", label: "Personal cloud" },
      ],
    },
  ],
};

const model = {
  label: "Model",
  groups: [
    {
      id: "models",
      items: [{ id: "gpt", label: "GPT-5.4", selected: true }],
    },
  ],
};

const mode = {
  label: "Mode",
  groups: [
    {
      id: "modes",
      items: [{ id: "dispatch", label: "Dispatch", selected: true }],
    },
  ],
};

describe("NewChatSurface", () => {
  afterEach(cleanup);

  it("keeps submit disabled until the controller allows submission", () => {
    const onSubmit = vi.fn();

    const { rerender } = render(
      <NewChatSurface
        heading="What should we run?"
        draft=""
        placeholder="Describe a task"
        canSubmit={false}
        submitting={false}
        target={target}
        model={model}
        mode={mode}
        notices={[]}
        actions={[]}
        onDraftChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("Send message").closest("button")?.disabled).toBe(true);

    rerender(
      <NewChatSurface
        heading="What should we run?"
        draft="Run tests"
        placeholder="Describe a task"
        canSubmit
        submitting={false}
        target={target}
        model={model}
        mode={mode}
        notices={[]}
        actions={[]}
        onDraftChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText("Send message"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("uses the shared chat column and gutter around the pre-message composer", () => {
    render(
      <NewChatSurface
        heading="What should we run?"
        draft=""
        placeholder="Describe a task"
        canSubmit={false}
        submitting={false}
        target={target}
        model={model}
        mode={mode}
        notices={[]}
        actions={[]}
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const composer = screen.getByPlaceholderText("Describe a task");
    const column = composer.closest('[class~="max-w-[46rem]"]');
    expect(column?.className).toContain(CHAT_COLUMN_CLASSNAME);
    expect(column?.parentElement?.className).toContain(CHAT_SURFACE_GUTTER_CLASSNAME);
  });

  it("emits draft and picker changes", () => {
    const onDraftChange = vi.fn();
    const onPickerSelect = vi.fn();

    render(
      <NewChatSurface
        heading="What should we run?"
        draft=""
        placeholder="Describe a task"
        canSubmit={false}
        submitting={false}
        target={target}
        model={model}
        mode={mode}
        notices={[]}
        actions={[]}
        onDraftChange={onDraftChange}
        onSubmit={vi.fn()}
        onPickerSelect={onPickerSelect}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Describe a task"), {
      target: { value: "hello" },
    });
    expect(onDraftChange).toHaveBeenCalledWith("hello");

    fireEvent.click(screen.getByText("Organization cloud"));
    fireEvent.click(screen.getByText("Personal cloud"));
    expect(onPickerSelect).toHaveBeenCalledWith("target", "personal");
  });
});
