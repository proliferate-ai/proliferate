// @vitest-environment jsdom

import type { UserInputQuestion, UserInputSubmittedAnswer } from "@anyharness/sdk";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserInputCard } from "./UserInputCard";

const OPTION_PLUS_OTHER: UserInputQuestion[] = [{
  questionId: "strategy",
  header: "Pick a strategy",
  question: "How should the agent proceed with the migration?",
  isOther: true,
  isSecret: false,
  options: [
    { label: "Small safe patch", description: "Keep scope narrow and verify quickly." },
    { label: "Full refactor", description: "Take the whole subsystem in one pass." },
  ],
}];

const FREEFORM_ONLY: UserInputQuestion[] = [{
  questionId: "workspace_name",
  header: "Name workspace",
  question: "What should the new worktree workspace be called?",
  isOther: false,
  isSecret: false,
  options: [],
}];

describe("UserInputCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("only shows the custom answer field after selecting None of the above", () => {
    const onSubmit = vi.fn<(answers: UserInputSubmittedAnswer[]) => void>();
    render(
      <UserInputCard
        title="Pick a strategy"
        questions={OPTION_PLUS_OTHER}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByPlaceholderText("Write a custom answer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /None of the above/i }));
    fireEvent.change(screen.getByPlaceholderText("Write a custom answer"), {
      target: { value: "Use a staged migration with checkpoints." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledWith([{
      questionId: "strategy",
      selectedOptionLabel: "None of the above",
      text: "Use a staged migration with checkpoints.",
    }]);
  });

  it("does not submit stale custom text after switching back to a normal option", () => {
    const onSubmit = vi.fn<(answers: UserInputSubmittedAnswer[]) => void>();
    render(
      <UserInputCard
        title="Pick a strategy"
        questions={OPTION_PLUS_OTHER}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /None of the above/i }));
    fireEvent.change(screen.getByPlaceholderText("Write a custom answer"), {
      target: { value: "Ignore the listed choices." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Small safe patch/i }));

    expect(screen.queryByPlaceholderText("Write a custom answer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledWith([{
      questionId: "strategy",
      selectedOptionLabel: "Small safe patch",
      text: undefined,
    }]);
  });

  it("keeps freeform-only questions editable", () => {
    const onSubmit = vi.fn<(answers: UserInputSubmittedAnswer[]) => void>();
    render(
      <UserInputCard
        title="Name workspace"
        questions={FREEFORM_ONLY}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Enter your answer"), {
      target: { value: "composer-cleanup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledWith([{
      questionId: "workspace_name",
      selectedOptionLabel: undefined,
      text: "composer-cleanup",
    }]);
  });
});
