// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowAgentCatalog,
  WorkflowDefinitionDraft,
} from "@proliferate/product-domain/workflows/definition";
import { WorkflowDefinitionEditor } from "./WorkflowDefinitionEditor";

class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

const catalog: WorkflowAgentCatalog = {
  catalogVersion: "probe-7",
  agents: [{
    kind: "claude",
    displayName: "Claude",
    session: {
      supportsGoals: true,
      controls: [{ key: "effort", mapping: { liveConfigId: "effort" } }],
      models: [{
        id: "default",
        displayName: "Default",
        defaultVisible: true,
        status: "active",
        controls: { effort: { values: ["low", "high"] } },
      }, {
        id: "haiku",
        displayName: "Haiku",
        defaultVisible: true,
        status: "active",
        controls: {},
      }],
    },
  }],
};

const initialDraft: WorkflowDefinitionDraft = {
  title: "Triage",
  description: "",
  defaultRepoConfigId: null,
  inputs: [],
  stages: [{
    harnessConfig: { agentKind: "claude", modelId: null, effort: null },
    steps: [{ kind: "agent.prompt", prompt: "Investigate", goal: null }],
  }],
};

afterEach(cleanup);

describe("WorkflowDefinitionEditor", () => {
  it("keeps no-repo and runtime-default selections explicit", () => {
    render(<EditorHarness />);

    expect((screen.getByLabelText("Default repository") as HTMLSelectElement).value).toBe("");
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(model.value).toBe("");
    expect([...model.options].map((option) => [option.value, option.text]))
      .toContainEqual(["default", "Default"]);
  });

  it("shows effort only from the selected model and clears it when model changes", () => {
    render(<EditorHarness />);

    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    const effort = screen.getByLabelText("Effort") as HTMLSelectElement;
    expect(effort.disabled).toBe(true);

    fireEvent.change(model, { target: { value: "default" } });
    expect(effort.disabled).toBe(false);
    expect([...effort.options].map((option) => option.value)).toEqual(["", "low", "high"]);
    fireEvent.change(effort, { target: { value: "high" } });
    expect(effort.value).toBe("high");

    fireEvent.change(model, { target: { value: "haiku" } });
    expect(effort.value).toBe("");
    expect(effort.disabled).toBe(true);
  });

  it("keeps the persisted definition free of authored ids while adding rows", () => {
    render(<EditorHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Add input" }));
    fireEvent.click(screen.getByRole("button", { name: "Add stage" }));

    expect(screen.getAllByLabelText(/Name/u)).toHaveLength(1);
    expect(screen.getByText("Stage 2")).toBeTruthy();
    expect(screen.queryByLabelText("Stage id")).toBeNull();
  });

  it("renders stale repo and catalog selections explicitly without rewriting them", () => {
    const staleDraft: WorkflowDefinitionDraft = {
      ...initialDraft,
      defaultRepoConfigId: "repo-gone",
      stages: [{
        harnessConfig: {
          agentKind: "retired-agent",
          modelId: "retired-model",
          effort: "ultra",
        },
        steps: [{ kind: "agent.prompt", prompt: "Investigate", goal: null }],
      }],
    };
    render(
      <WorkflowDefinitionEditor
        mode="edit"
        draft={staleDraft}
        catalog={catalog}
        repositories={[]}
        issues={[]}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Default repository") as HTMLSelectElement).value)
      .toBe("repo-gone");
    expect(screen.getByRole("option", { name: /Saved repository unavailable/u })).toBeTruthy();
    expect((screen.getByLabelText("Harness") as HTMLSelectElement).value).toBe("retired-agent");
    expect(screen.getByRole("option", { name: /Unavailable harness/u })).toBeTruthy();
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("retired-model");
    expect(screen.getByRole("option", { name: /Unavailable model/u })).toBeTruthy();
    expect((screen.getByLabelText("Effort") as HTMLSelectElement).value).toBe("ultra");
    expect((screen.getByLabelText("Effort") as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByRole("option", { name: /Unavailable effort/u })).toBeTruthy();
  });
});

function EditorHarness() {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <WorkflowDefinitionEditor
      mode="create"
      draft={draft}
      catalog={catalog}
      repositories={[{ id: "repo-1", label: "proliferate-ai/proliferate" }]}
      issues={[]}
      onChange={setDraft}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}
