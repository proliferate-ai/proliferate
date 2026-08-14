// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkflowBuilderPromptField } from "#product/components/workflows/builder-v2/WorkflowBuilderPromptField";

afterEach(() => {
  cleanup();
});

describe("WorkflowBuilderPromptField", () => {
  it("chips each reference and marks only the undeclared one", () => {
    renderField({
      value: "Read @doc:findings for @input:goal, then write @doc:report.",
      inputNames: ["goal"],
      docSlugs: ["findings"],
    });

    // One prompt, three references, two declared: the resolved/unresolved
    // split is the assertion, so a chip that lost its tone fails here.
    expect(chipState("@doc:findings")).toBe("true");
    expect(chipState("@input:goal")).toBe("true");
    expect(chipState("@doc:report")).toBe("false");
  });

  it("resolves a chip the moment its document is declared", () => {
    const { rerender } = renderField({
      value: "Write @doc:report.",
      inputNames: [],
      docSlugs: [],
    });
    expect(chipState("@doc:report")).toBe("false");

    rerender(
      <WorkflowBuilderPromptField
        fieldId="prompt"
        value="Write @doc:report."
        disabled={false}
        inputNames={new Set()}
        docSlugs={new Set(["report"])}
        invalid={false}
        onChange={() => {}}
      />,
    );

    expect(chipState("@doc:report")).toBe("true");
  });

  it("keeps the prose between chips so the preview mirrors the prompt", () => {
    renderField({
      value: "Investigate @input:goal now.",
      inputNames: ["goal"],
      docSlugs: [],
    });

    expect(screen.getByText(/Prompt preview/).parentElement?.textContent)
      .toContain("Investigate @input:goal now.");
  });

  it("shows no preview for a prompt that references nothing", () => {
    renderField({ value: "Investigate the issue.", inputNames: [], docSlugs: [] });

    expect(screen.queryByText(/Prompt preview/)).toBeNull();
  });

  it("reports edits verbatim", () => {
    const onChange = vi.fn();
    renderField({ value: "", inputNames: [], docSlugs: [], onChange });

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "See @doc:notes" },
    });

    expect(onChange).toHaveBeenCalledWith("See @doc:notes");
  });
});

function renderField({
  value,
  inputNames,
  docSlugs,
  onChange = () => {},
}: {
  value: string;
  inputNames: string[];
  docSlugs: string[];
  onChange?: (prompt: string) => void;
}) {
  return render(
    <WorkflowBuilderPromptField
      fieldId="prompt"
      value={value}
      disabled={false}
      inputNames={new Set(inputNames)}
      docSlugs={new Set(docSlugs)}
      invalid={false}
      onChange={onChange}
    />,
  );
}

/** `data-resolved` is the chip's own record of which tone it painted. */
function chipState(raw: string): string | null {
  return screen.getByText(raw).getAttribute("data-resolved");
}
