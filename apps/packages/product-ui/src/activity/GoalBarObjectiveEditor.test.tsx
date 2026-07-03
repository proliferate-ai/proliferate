/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalBarObjectiveEditor } from "./GoalBarObjectiveEditor";

afterEach(() => {
  cleanup();
});

function renderEditor(overrides?: Partial<{ initialValue: string }>) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <GoalBarObjectiveEditor
      initialValue={overrides?.initialValue ?? ""}
      placeholder="Describe the goal to pursue"
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  );
  const textarea = screen.getByLabelText("Goal objective") as HTMLTextAreaElement;
  return { onCommit, onCancel, textarea };
}

describe("GoalBarObjectiveEditor", () => {
  it("renders a multi-line textarea with a 3-row minimum and the initial value", () => {
    const { textarea } = renderEditor({ initialValue: "Line one\nLine two" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.rows).toBe(3);
    expect(textarea.value).toBe("Line one\nLine two");
  });

  it("renders explicit commit and cancel icon buttons", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "Save goal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("commits the trimmed objective on Cmd+Enter", () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.change(textarea, { target: { value: "  ship the thing  " } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onCommit).toHaveBeenCalledWith("ship the thing");
  });

  it("commits on Ctrl+Enter too", () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.change(textarea, { target: { value: "fix CI" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledWith("fix CI");
  });

  it("does not commit or cancel on a plain Enter (leaves the newline to the textarea)", () => {
    const { onCommit, onCancel, textarea } = renderEditor();
    fireEvent.change(textarea, { target: { value: "multi\nline" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const { onCancel, textarea } = renderEditor({ initialValue: "existing goal" });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels instead of committing an empty/whitespace-only objective", () => {
    const { onCommit, onCancel, textarea } = renderEditor();
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("wires the Save/Cancel buttons to the same commit/cancel paths", () => {
    const { onCommit, textarea } = renderEditor();
    fireEvent.change(textarea, { target: { value: "click to save" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(onCommit).toHaveBeenCalledWith("click to save");
  });

  it("cancel button calls onCancel", () => {
    const { onCancel } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
