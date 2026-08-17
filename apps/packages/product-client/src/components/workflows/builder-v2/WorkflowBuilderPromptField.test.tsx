// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkflowBuilderPromptField } from "#product/components/workflows/builder-v2/WorkflowBuilderPromptField";

afterEach(() => {
  cleanup();
});

describe("WorkflowBuilderPromptField", () => {
  it("renders only the editable prompt without help copy or a repeated preview", () => {
    renderField("Review the implementation against @doc:design.");

    expect(screen.getByLabelText("Prompt")).toHaveProperty(
      "value",
      "Review the implementation against @doc:design.",
    );
    expect(screen.queryByText(/Write @input:name/)).toBeNull();
    expect(screen.queryByText("Prompt preview")).toBeNull();
    expect(screen.getAllByText("Review the implementation against @doc:design.")).toHaveLength(1);
  });

  it("reports edits verbatim", () => {
    const onChange = vi.fn();
    renderField("", onChange);

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "See @doc:notes" },
    });

    expect(onChange).toHaveBeenCalledWith("See @doc:notes");
  });
});

function renderField(value: string, onChange: (prompt: string) => void = () => {}) {
  return render(
    <WorkflowBuilderPromptField
      fieldId="prompt"
      value={value}
      disabled={false}
      invalid={false}
      onChange={onChange}
    />,
  );
}
