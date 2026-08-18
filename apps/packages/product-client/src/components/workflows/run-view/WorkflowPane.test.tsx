// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunDocV2, WorkflowRunV2 } from "@anyharness/sdk";
import { WorkflowPane } from "#product/components/workflows/run-view/WorkflowPane";
import type { WorkflowGraphSlotVM } from "#product/domain/workflows/run-view-model";
import type { WorkflowPaneModel } from "#product/hooks/workflows/facade/use-workflow-pane";

const WORKSPACE_ID = "workspace-pane";

const mocks = vi.hoisted(() => ({
  roster: { status: "ready" as const, visibleRuns: [] as WorkflowRunV2[] },
  paneByRunId: new Map<string, WorkflowPaneModel>(),
  openDoc: vi.fn(),
  useWorkflowRunRoster: vi.fn(),
  useWorkflowPane: vi.fn(),
}));

vi.mock("#product/hooks/workflows/facade/use-workflow-pane", () => ({
  useWorkflowRunRoster: mocks.useWorkflowRunRoster,
  useWorkflowPane: mocks.useWorkflowPane,
}));

vi.mock("#product/hooks/workflows/ui/use-workflow-doc-open", () => ({
  useWorkflowDocOpen: () => mocks.openDoc,
}));

function run(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: WORKSPACE_ID,
    status: "running",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-14T00:00:00Z",
    updatedAt: "2026-08-14T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

function slot(chainIndex: number): WorkflowGraphSlotVM {
  return { chainIndex, attempts: [], adhoc: [] } as unknown as WorkflowGraphSlotVM;
}

function doc(slug: string): WorkflowRunDocV2 {
  return {
    id: `doc-${slug}`,
    runId: "run-1",
    slug,
    filename: `${slug}.md`,
    producingNodeRowId: null,
    seededFromTemplate: false,
    createdAt: "2026-08-14T00:00:00Z",
    updatedAt: "2026-08-14T00:00:00Z",
  };
}

/** A minimal, ready `WorkflowPaneModel`, one per run id, distinguishable by its slots/docs. */
function paneModelFor(theRun: WorkflowRunV2, slots: WorkflowGraphSlotVM[], docs: WorkflowRunDocV2[]): WorkflowPaneModel {
  return {
    status: "ready",
    run: theRun,
    slots,
    docs,
    nodesById: new Map(),
    interrupted: false,
    busy: false,
    needsInputNodeRowIds: new Set(),
    actions: {
      approve: vi.fn(),
      failRedo: vi.fn(),
      flipType: vi.fn(),
      undoAdvance: vi.fn(),
      resume: vi.fn(),
      addAdhocNode: vi.fn(),
      focusNodeSession: vi.fn(),
    },
  };
}

beforeEach(() => {
  mocks.paneByRunId.clear();
  mocks.openDoc.mockReset();
  mocks.useWorkflowRunRoster.mockImplementation(() => mocks.roster);
  mocks.useWorkflowPane.mockImplementation(({ run: theRun }: { run: WorkflowRunV2 }) => {
    const found = mocks.paneByRunId.get(theRun.id);
    if (!found) {
      throw new Error(`no pane model stubbed for run ${theRun.id}`);
    }
    return found;
  });
});

afterEach(() => {
  cleanup();
});

describe("WorkflowPane", () => {
  it("renders exactly one graph and one docs group for the ordinary single-run case", () => {
    const solo = run({ id: "solo" });
    mocks.roster = { status: "ready", visibleRuns: [solo] };
    mocks.paneByRunId.set("solo", paneModelFor(solo, [slot(0)], [doc("plan")]));

    render(<WorkflowPane workspaceId={WORKSPACE_ID} />);

    expect(screen.getAllByRole("group", { name: "Run graph" })).toHaveLength(1);
    expect(screen.getByText("plan.md")).toBeTruthy();
    // No run-identifying label: with one visible run, the rail's own header
    // text is withheld — the single-run pane looks exactly as it always has.
    expect(screen.queryByText(`Run ${solo.id}`)).toBeNull();
  });

  it("renders two independent rails — one graph and one doc group per run — for concurrent runs", () => {
    const older = run({ id: "older", status: "running" });
    const newer = run({ id: "newer", status: "awaiting_human" });
    mocks.roster = { status: "ready", visibleRuns: [newer, older] };
    mocks.paneByRunId.set("older", paneModelFor(older, [slot(0)], [doc("older-doc")]));
    mocks.paneByRunId.set("newer", paneModelFor(newer, [slot(0), slot(1)], [doc("newer-doc")]));

    render(<WorkflowPane workspaceId={WORKSPACE_ID} />);

    // Negative control: were selection still collapsing to one run, this
    // would find one graph and one doc group instead of two of each.
    expect(screen.getAllByRole("group", { name: "Run graph" })).toHaveLength(2);
    expect(screen.getByText("older-doc.md")).toBeTruthy();
    expect(screen.getByText("newer-doc.md")).toBeTruthy();
    expect(screen.getByText(`Run ${older.id}`)).toBeTruthy();
    expect(screen.getByText(`Run ${newer.id}`)).toBeTruthy();
  });

  it("caps the rendered rails at four and pages the rest behind the overflow line (ruling F-A2)", () => {
    const runs = [5, 4, 3, 2, 1].map((minute) =>
      run({ id: `r${minute}`, createdAt: `2026-08-14T00:0${minute}:00Z` }));
    mocks.roster = { status: "ready", visibleRuns: runs };
    for (const item of runs) {
      mocks.paneByRunId.set(item.id, paneModelFor(item, [slot(0)], []));
    }

    render(<WorkflowPane workspaceId={WORKSPACE_ID} />);

    // Negative control: an uncapped map would render five graphs and no
    // overflow line.
    expect(screen.getAllByRole("group", { name: "Run graph" })).toHaveLength(4);
    expect(screen.queryByText("Run r1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 more run" }));
    expect(screen.getByText("Run r1")).toBeTruthy();
    expect(screen.getAllByRole("group", { name: "Run graph" })).toHaveLength(1);
  });

  it("promotes a run waiting on a human into the resting page instead of hiding it (ruling F-A2)", () => {
    const gated = run({ id: "gated", status: "awaiting_human", createdAt: "2026-08-14T00:01:00Z" });
    const runs = [
      run({ id: "r5", createdAt: "2026-08-14T00:05:00Z" }),
      run({ id: "r4", createdAt: "2026-08-14T00:04:00Z" }),
      run({ id: "r3", createdAt: "2026-08-14T00:03:00Z" }),
      run({ id: "r2", createdAt: "2026-08-14T00:02:00Z" }),
      gated,
    ];
    mocks.roster = { status: "ready", visibleRuns: runs };
    for (const item of runs) {
      mocks.paneByRunId.set(item.id, paneModelFor(item, [slot(0)], []));
    }

    render(<WorkflowPane workspaceId={WORKSPACE_ID} />);

    // The oldest run is the one waiting on a human: it renders on page 0 and
    // the newest merely-running run is what waits behind the overflow line.
    expect(screen.getByText("Run gated")).toBeTruthy();
    expect(screen.queryByText("Run r2")).toBeNull();
  });

  it("shows the empty state when the roster has no visible run", () => {
    mocks.roster = { status: "empty", visibleRuns: [] };

    render(<WorkflowPane workspaceId={WORKSPACE_ID} />);

    expect(screen.getByText("No workflow run here")).toBeTruthy();
  });
});
