// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";
import { WorkflowJsonEditor } from "#product/components/workflows/builder-v2/WorkflowJsonEditor";

afterEach(() => {
  cleanup();
});

/**
 * What the pane re-seeds from the graph and what it keeps. An incomplete draft
 * does not parse either — a step still needs a title and a prompt — so "does
 * the text parse" cannot stand in for "did the author type this".
 */
describe("WorkflowJsonEditor", () => {
  it("re-seeds from a graph that is still incomplete", () => {
    const onValidityChange = vi.fn();
    const view = render(
      <WorkflowJsonEditor
        definition={definition("", "")}
        active={false}
        disabled={false}
        onApply={() => {}}
        onValidityChange={onValidityChange}
      />,
    );
    view.rerender(editor(definition("", ""), true, onValidityChange));
    expect(sourceNodes()[0]).toMatchObject({ title: "", prompt: "" });

    // Away and back with the graph filled in between: the pane never held an
    // edit of its own, so it must show what the graph now holds.
    view.rerender(editor(definition("", ""), false, onValidityChange));
    view.rerender(editor(definition("Diagnose", "Investigate."), true, onValidityChange));

    expect(sourceNodes()[0]).toMatchObject({ title: "Diagnose", prompt: "Investigate." });
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("names an unknown field, refuses the edit, and reverts to the graph", () => {
    const onApply = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <WorkflowJsonEditor
        definition={definition("Diagnose", "Investigate.")}
        active
        disabled={false}
        onApply={onApply}
        onValidityChange={onValidityChange}
      />,
    );
    const textarea = screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement;
    const source = textarea.value;

    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({ ...JSON.parse(source) as object, unexpected: true }, null, 2),
      },
    });

    // The exact sentence the tier-2 definition-lifecycle spec waits for.
    expect(screen.getByText("The definition contains an unknown field.")).toBeTruthy();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.getByText("Valid WorkflowDefinitionV2")).toBeTruthy();
    expect((screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement).value)
      .toBe(source);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("reverts to a graph that has its own issue, and names that issue", () => {
    // The graph a revert lands on is whatever the author has built so far, and
    // that is routinely not yet valid. The pane must report the graph's own
    // issue rather than "Valid" or the author's discarded text.
    const unresolved = definition("Diagnose", "Write @doc:findings.");
    const onValidityChange = vi.fn();
    render(editor(unresolved, true, onValidityChange));
    const textarea = screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: '{"schemaVersion": 2' } });
    expect(screen.getByText("JSON syntax is invalid.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.getByText(
      "Node “step-1” prompt references unknown doc template “@doc:findings”.",
    )).toBeTruthy();
    // Still savable-from-the-graph's point of view: the JSON gate only refuses
    // text the author typed, and there is none left.
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("keeps text the author typed that cannot be parsed", () => {
    const onValidityChange = vi.fn();
    const view = render(editor(definition("Diagnose", "Investigate."), true, onValidityChange));

    fireEvent.change(screen.getByLabelText("Workflow definition JSON"), {
      target: { value: '{"schemaVersion": 2' },
    });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    view.rerender(editor(definition("Diagnose", "Investigate."), false, onValidityChange));
    view.rerender(editor(definition("Renamed", "Investigate."), true, onValidityChange));

    expect((screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement).value)
      .toBe('{"schemaVersion": 2');
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });
});

function editor(
  value: WorkflowDefinitionV2,
  active: boolean,
  onValidityChange: (valid: boolean) => void,
) {
  return (
    <WorkflowJsonEditor
      definition={value}
      active={active}
      disabled={false}
      onApply={() => {}}
      onValidityChange={onValidityChange}
    />
  );
}

function sourceNodes(): WorkflowDefinitionV2["nodes"] {
  const textarea = screen.getByLabelText("Workflow definition JSON") as HTMLTextAreaElement;
  return JSON.parse(textarea.value).nodes;
}

function definition(title: string, prompt: string): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: [{ id: "step-1", type: "agent", title, prompt }],
    edges: [],
    inputs: [],
    docTemplates: [],
  };
}
