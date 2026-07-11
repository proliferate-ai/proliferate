// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";
import type { WorkflowDefinition, WorkflowParallelGroup } from "@proliferate/product-domain/workflows/definition";
import { ensureDefinitionIds } from "@/lib/domain/workflows/drag-identity";
import { WorkflowSpineCanvas } from "./WorkflowSpineCanvas";
import type { EditorAgent } from "./WorkflowStepPanel";

afterEach(cleanup);

const AGENTS: EditorAgent[] = [
  { kind: "claude", displayName: "Claude", models: [{ id: "haiku", label: "Haiku" }] },
];

function makeDefinition(): WorkflowDefinition {
  return ensureDefinitionIds({
    version: 1,
    inputs: [],
    integrations: [],
    agents: [
      {
        parallel: [
          {
            slot: "review_a",
            harness: "claude",
            model: "haiku",
            steps: [
              { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "", label: "A-first" },
              { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "", label: "A-second" },
            ],
          },
          {
            slot: "review_b",
            harness: "claude",
            model: "haiku",
            steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "", label: "B-first" }],
          },
        ],
      },
    ],
  });
}

/**
 * A minimal harness that owns the draft + drag state exactly like the editor:
 * a lane rename mid-drag mutates only the editable slot label, never the stable
 * IDs the drop resolves against.
 */
function Harness({ onReorderStep }: { onReorderStep: (a: SpineAddress, from: number, to: number) => void }) {
  const [definition, setDefinition] = useState<WorkflowDefinition>(makeDefinition);
  const [dragStepId, setDragStepId] = useState<string | null>(null);
  const noop = () => {};
  const renameLaneA = () =>
    setDefinition((prev) => ({
      ...prev,
      agents: prev.agents.map((entry) => {
        const group = entry as WorkflowParallelGroup;
        if (!("parallel" in group)) return entry;
        return {
          ...group,
          parallel: group.parallel.map((lane) =>
            lane.slot === "review_a" ? { ...lane, slot: "renamed_a" } : lane,
          ),
        };
      }),
    }));

  return (
    <div>
      <button type="button" onClick={renameLaneA}>
        rename-lane
      </button>
      <WorkflowSpineCanvas
        name="wf"
        description=""
        definition={definition}
        issues={[]}
        agents={AGENTS}
        functionProviderDisplayNames={new Map()}
        triggerChips={["manual"]}
        setupOpen={false}
        selectedStep={null}
        setupTarget={null}
        totalAgentCount={3}
        dragStepId={dragStepId}
        onDragStepIdChange={setDragStepId}
        dragEntryId={null}
        onDragEntryIdChange={noop}
        dragLaneId={null}
        onDragLaneIdChange={noop}
        onOpenSetup={noop}
        onSelectAgent={noop}
        onSelectStep={noop}
        onAddStep={noop}
        onReorderStep={onReorderStep}
        onDuplicateStep={noop}
        onDeleteStep={noop}
        onAddAgentNode={noop}
        onAddAgentInParallel={noop}
        onParallelizeEntry={noop}
        onAddLane={noop}
        onRemoveLane={noop}
        onDeleteSpineEntry={noop}
        onReorderSpineEntry={noop}
        onReorderLane={noop}
      />
    </div>
  );
}

function draggableOf(label: string): HTMLElement {
  const row = screen.getByRole("button", { name: label });
  const wrapper = row.closest("div[draggable]");
  if (!wrapper) {
    throw new Error(`no draggable wrapper for ${label}`);
  }
  return wrapper as HTMLElement;
}

describe("WorkflowSpineCanvas drag topology safety (WS9b item 4)", () => {
  it("a lane rename mid-drag still lands the drop on the right (renamed) node", () => {
    const onReorderStep = vi.fn<(a: SpineAddress, from: number, to: number) => void>();
    render(<Harness onReorderStep={onReorderStep} />);

    // Start dragging lane A's first step.
    fireEvent.dragStart(draggableOf("A-first"));
    // Rename the lane label WHILE the drag is in flight.
    fireEvent.click(screen.getByRole("button", { name: "rename-lane" }));
    // Drop onto lane A's second step (its label is unchanged; the lane slot is now "renamed_a").
    fireEvent.drop(draggableOf("A-second"));

    // The drop resolved by ID to the renamed lane — never the stale "review_a"
    // and never lane B.
    expect(onReorderStep).toHaveBeenCalledTimes(1);
    expect(onReorderStep).toHaveBeenCalledWith({ spineIndex: 0, lane: "renamed_a" }, 0, 1);
  });

  it("dropping a step onto a different lane's step is rejected (no cross-node move)", () => {
    const onReorderStep = vi.fn<(a: SpineAddress, from: number, to: number) => void>();
    render(<Harness onReorderStep={onReorderStep} />);

    fireEvent.dragStart(draggableOf("A-first"));
    fireEvent.drop(draggableOf("B-first"));

    expect(onReorderStep).not.toHaveBeenCalled();
  });
});
