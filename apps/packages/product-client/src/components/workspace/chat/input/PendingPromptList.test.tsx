// @vitest-environment jsdom

import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  derivePendingPromptQueueRow,
  derivePendingPromptQueueRows,
} from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import {
  ConnectedPendingPromptList,
  PendingPromptList,
  type PendingPromptListProps,
} from "#product/components/workspace/chat/input/PendingPromptList";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { delegatedWorkVisualIdentity } from "#product/lib/domain/delegated-work/identity";
import { solidSealGeometry } from "#product/lib/domain/delegated-work/solid-seal";

const usePendingPromptQueueMock = vi.hoisted(() => vi.fn());
const openWorkspaceSessionMock = vi.hoisted(() => vi.fn());
const openAgentsPaneTargetMock = vi.hoisted(() => vi.fn());

vi.mock("#product/hooks/chat/ui/use-pending-prompt-queue", () => ({
  usePendingPromptQueue: usePendingPromptQueueMock,
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: openWorkspaceSessionMock,
  }),
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-navigation-actions", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("#product/hooks/agents/workflows/use-agents-pane-navigation-actions")
  >(),
  useAgentsPaneNavigationActions: () => ({
    classifyAgentsPaneTarget: () => "subagent",
    openAgentsPaneTarget: openAgentsPaneTargetMock,
  }),
}));

const ENTRIES = [
  derivePendingPromptQueueRow({
    seq: 4,
    promptId: "duplicate-id",
    text: "first",
    contentParts: [],
    isBeingEdited: false,
  }),
  derivePendingPromptQueueRow({
    seq: 9,
    promptId: "duplicate-id",
    text: "second",
    contentParts: [],
    isBeingEdited: false,
  }),
];

function renderList(overrides: Partial<PendingPromptListProps> = {}) {
  const props: PendingPromptListProps = {
    entries: ENTRIES,
    steeringSeq: null,
    sessionMaterialized: true,
    queueMutationInFlight: false,
    onBeginEdit: vi.fn(),
    onDelete: vi.fn(),
    onSteer: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  return { ...render(<PendingPromptList {...props} />), props };
}

describe("PendingPromptList", () => {
  afterEach(() => {
    cleanup();
    usePendingPromptQueueMock.mockReset();
    openWorkspaceSessionMock.mockReset();
    openAgentsPaneTargetMock.mockReset();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
  });

  it("uses native keyboard-operable buttons for reorder handles", () => {
    const { props } = renderList();
    const handles = screen.getAllByRole("button", { name: "Reorder queued message" });

    expect(handles).toHaveLength(2);
    expect(handles[0]?.tagName).toBe("BUTTON");
    expect(handles[0]?.getAttribute("aria-keyshortcuts")).toBe("ArrowUp ArrowDown");

    fireEvent.keyDown(handles[0]!, { key: "ArrowDown" });
    expect(props.onReorder).toHaveBeenCalledWith(0, 1);

    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" });
    expect(props.onReorder).toHaveBeenCalledWith(1, 0);
  });

  it("disables queue actions and drag handles during either queue mutation", () => {
    renderList({ queueMutationInFlight: true });

    expect(screen.queryByRole("button", { name: "Reorder queued message" })).toBeNull();
    const steerButtons = screen.getAllByRole("button", {
      name: "Send next — interrupts the current turn",
    });
    expect(steerButtons).toHaveLength(2);
    expect(steerButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(
      screen.getAllByRole("button", { name: "Edit queued message" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(
      screen.getAllByRole("button", { name: "Delete queued message" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("skips local outbox rows during keyboard reorder", () => {
    const localRow = derivePendingPromptQueueRow({
      seq: -1,
      promptId: "local-prompt",
      text: "dispatching locally",
      contentParts: [],
      isBeingEdited: false,
      localOutboxDeliveryState: "dispatching",
    });
    const { props } = renderList({ entries: [ENTRIES[0]!, localRow, ENTRIES[1]!] });
    const handles = screen.getAllByRole("button", { name: "Reorder queued message" });

    fireEvent.keyDown(handles[0]!, { key: "ArrowDown" });
    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" });

    expect(props.onReorder).toHaveBeenNthCalledWith(1, 0, 2);
    expect(props.onReorder).toHaveBeenNthCalledWith(2, 2, 0);
  });

  it("renders one no-control agent aggregate with unique clickable durable glyphs", () => {
    const entries = derivePendingPromptQueueRows([
      {
        seq: 1,
        text: "user",
        contentParts: [],
        isBeingEdited: false,
      },
      {
        seq: 2,
        text: "hidden reply one",
        contentParts: [],
        isBeingEdited: false,
        promptProvenance: {
          type: "agentSession",
          sourceSessionId: "agent-1",
          label: "Schema audit",
        },
      },
      {
        seq: 3,
        text: "hidden reply two",
        contentParts: [],
        isBeingEdited: false,
        promptProvenance: {
          type: "agentSession",
          sourceSessionId: "agent-1",
          label: "Schema audit",
        },
      },
      {
        seq: 4,
        text: "unresolved wake",
        contentParts: [],
        isBeingEdited: false,
        promptProvenance: {
          type: "subagentWake",
          sessionLinkId: "link-unresolved",
          completionId: "completion-unresolved",
        },
      },
    ]);
    const onOpenAgent = vi.fn();
    renderList({ entries, onOpenAgent });

    const aggregate = document.querySelector("[data-pending-agent-updates]");
    expect(aggregate).toBeTruthy();
    expect(aggregate?.textContent).toContain("From subagents");
    expect(aggregate?.textContent).toContain("3 updates");
    expect(aggregate?.textContent).toContain("delivered next turn");
    expect(aggregate?.textContent).not.toContain("hidden reply");
    expect(within(aggregate as HTMLElement).queryByRole("button", {
      name: "Edit queued message",
    })).toBeNull();
    const glyphs = aggregate?.querySelectorAll("[data-pending-agent-glyph]") ?? [];
    expect(glyphs).toHaveLength(1);

    fireEvent.click(glyphs[0]!);
    expect(onOpenAgent).toHaveBeenCalledWith("agent-1");
  });

  it("never exposes a no-op reorder handle on review or hidden-agent rows", () => {
    const entries = derivePendingPromptQueueRows([
      {
        seq: 1,
        text: "user A",
        contentParts: [],
        isBeingEdited: false,
      },
      {
        seq: 2,
        text: "Review feedback is ready.",
        contentParts: [],
        isBeingEdited: false,
        promptProvenance: {
          type: "reviewFeedback",
          reviewRunId: "run-1",
          reviewRoundId: "round-1",
          feedbackJobId: "job-1",
        },
      },
      {
        seq: 3,
        text: "user B",
        contentParts: [],
        isBeingEdited: false,
      },
      {
        seq: 4,
        text: "hidden agent update",
        contentParts: [],
        isBeingEdited: false,
        promptProvenance: {
          type: "agentSession",
          sourceSessionId: "agent-1",
        },
      },
    ]);

    renderList({ entries });

    expect(screen.getAllByRole("button", { name: "Reorder queued message" })).toHaveLength(2);
    expect(screen.getByText("Review feedback ready").closest("[data-reorder-item]")
      ?.querySelector('[aria-label="Reorder queued message"]')).toBeNull();
    expect(document.querySelector("[data-pending-agent-updates]")
      ?.querySelector('[aria-label="Reorder queued message"]')).toBeNull();
  });

  it("keeps a durable pending glyph non-clickable when its workspace is unresolved", () => {
    const entries = derivePendingPromptQueueRows([{
      seq: 1,
      text: "hidden cowork update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "agentSession",
        sourceSessionId: "agent-without-directory",
        label: "Coding pass",
      },
    }]);
    const onOpenAgent = vi.fn();

    renderList({
      entries,
      onOpenAgent,
      canOpenAgent: () => false,
    });

    expect(document.querySelector("[data-pending-agent-glyph='agent-without-directory']")
      ?.hasAttribute("data-agent-navigation-unresolved")).toBe(true);
    expect(screen.queryByRole("button", { name: /open .*coding pass/i })).toBeNull();
    expect(onOpenAgent).not.toHaveBeenCalled();
  });

  it("targets only its durable directory mapping and navigates through the client session key", () => {
    const rows = derivePendingPromptQueueRows([{
      seq: 1,
      text: "hidden agent update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "agentSession",
        sourceSessionId: "durable-agent-session",
        label: "Schema audit",
      },
    }]);
    usePendingPromptQueueMock.mockReturnValue({
      rows,
      steeringSeq: null,
      sessionMaterialized: true,
      queueMutationInFlight: false,
      onBeginEdit: vi.fn(),
      onDelete: vi.fn(),
      onSteer: vi.fn(),
      onReorder: vi.fn(),
    });
    let renderCount = 0;

    render(
      <Profiler id="connected-pending" onRender={() => { renderCount += 1; }}>
        <ConnectedPendingPromptList />
      </Profiler>,
    );
    const initialRenderCount = renderCount;
    expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();

    act(() => {
      useSessionDirectoryStore.getState().upsertEntry({
        sessionId: "unrelated-session",
        workspaceId: "workspace-other",
        agentKind: "codex",
        title: "Unrelated activity",
      });
    });
    expect(renderCount).toBe(initialRenderCount);

    act(() => {
      useSessionDirectoryStore.getState().upsertEntry({
        sessionId: "client-session:agent",
        materializedSessionId: "durable-agent-session",
        workspaceId: "workspace-agent",
        agentKind: "codex",
        title: "Schema audit",
        sessionRelationship: { kind: "root" },
      });
    });
    expect(renderCount).toBeGreaterThan(initialRenderCount);

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(openWorkspaceSessionMock).toHaveBeenCalledWith({
      workspaceId: "workspace-agent",
      sessionId: "client-session:agent",
    });
    const expectedGeometry = solidSealGeometry(
      delegatedWorkVisualIdentity("durable-agent-session").glyphSeedHash,
    );
    const notch = document.querySelector("[data-solid-seal-notch]");
    expect(notch?.getAttribute("cx")).toBe(String(expectedGeometry.notchX));
    expect(notch?.getAttribute("cy")).toBe(String(expectedGeometry.notchY));
  });
});
