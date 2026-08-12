// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOperationsToolActionRow } from "#product/components/workspace/chat/tool-calls/AgentOperationsToolActionRow";
import { TranscriptContextProviders } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import type {
  AgentOperationsAgentTarget,
  AgentOperationsReceiptAction,
  AgentOperationsReceiptPresentation,
} from "#product/domain/chats/tools/agent-operations-tool-presentation";
import type { SessionRelationship } from "#product/lib/domain/sessions/directory/relationship";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

const mocks = vi.hoisted(() => ({
  openAgentsPaneTarget: vi.fn(() => false),
  openWorkspaceSession: vi.fn(),
  projectedWorkspaceIds: new Set<string>(),
  selectWorkspace: vi.fn(),
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-navigation-actions", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("#product/hooks/agents/workflows/use-agents-pane-navigation-actions")
  >();
  return {
    ...original,
    useAgentsPaneNavigationActions: () => ({
      classifyAgentsPaneTarget: () => "subagent" as const,
      openAgentsPaneTarget: mocks.openAgentsPaneTarget,
    }),
  };
});

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      allWorkspaces: [...mocks.projectedWorkspaceIds].map((id) => ({ id })),
    },
  }),
}));

beforeEach(() => {
  mocks.openAgentsPaneTarget.mockReset().mockReturnValue(false);
  mocks.openWorkspaceSession.mockReset();
  mocks.selectWorkspace.mockReset();
  mocks.projectedWorkspaceIds = new Set(["workspace-1"]);
  useSessionDirectoryStore.getState().clearEntries();
});

afterEach(() => {
  cleanup();
});

describe("AgentOperationsToolActionRow navigation", () => {
  it.each(["durable", "matching pending"] as const)(
    "owns a current-workspace subagent with %s authority when the pane opener declines",
    (authority) => {
      if (authority === "durable") {
        useSessionDirectoryStore.getState().recordRelationshipHint("durable-child", {
          kind: "subagent_child",
          parentSessionId: "durable-parent",
          relation: "subagent",
          workspaceId: "workspace-1",
        });
      } else {
        useSessionDirectoryStore.getState().upsertEntry({
          sessionId: "client-session:pending",
          materializedSessionId: "durable-child",
          workspaceId: "workspace-1",
          agentKind: "codex",
          title: "Schema audit",
          sessionRelationship: { kind: "pending" },
        });
      }
      const onOpenSession = vi.fn();

      renderRow({
        presentation: presentation({
          agent: agent({
            sessionId: "durable-child",
            parentSessionId: "durable-parent",
            workspaceId: "workspace-1",
            role: "subagent",
          }),
        }),
        onOpenSession,
      });

      fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));

      expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        parentSessionId: "durable-parent",
        childSessionId: "durable-child",
        historicalSubagentProvenance: true,
      });
      expect(onOpenSession).not.toHaveBeenCalled();
      expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
    },
  );

  it.each(["absent", "pending without workspace", "pending with mismatched workspace"] as const)(
    "keeps a historical subagent operation non-clickable while current authority is %s",
    (authority) => {
      if (authority !== "absent") {
        useSessionDirectoryStore.getState().upsertEntry({
          sessionId: "client-session:pending",
          materializedSessionId: "durable-child",
          workspaceId: authority === "pending without workspace" ? null : "workspace-other",
          agentKind: "codex",
          title: "Schema audit",
          sessionRelationship: { kind: "pending" },
        });
      }
      const onOpenSession = vi.fn();

      const { container } = renderRow({ presentation: presentation(), onOpenSession });

      expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
      expect(onOpenSession).not.toHaveBeenCalled();
      expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
    },
  );

  it("accepts linked_child relation=subagent and maps the parent to durable identity", () => {
    mocks.openAgentsPaneTarget.mockReturnValue(true);
    upsertDirectoryEntry("client-parent", "durable-parent", { kind: "root" }, "Parent");
    upsertDirectoryEntry("client-child", "durable-child", {
      kind: "linked_child",
      parentSessionId: "client-parent",
      relation: "subagent",
      workspaceId: "workspace-1",
    }, "Compatibility child");
    const onOpenSession = vi.fn();

    renderRow({
      presentation: presentation({
        agent: agent({
          sessionId: "durable-child",
          parentSessionId: null,
          workspaceId: null,
          role: null,
          title: "Compatibility child",
        }),
      }),
      onOpenSession,
    });

    fireEvent.click(screen.getByRole("button", { name: /open .*compatibility child/i }));
    expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: "durable-parent",
      childSessionId: "durable-child",
      historicalSubagentProvenance: false,
    });
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it.each([
    ["open_subagent" as const, "ordinary", "generic"],
  ])("keeps %s role=%s on the existing session fallback", (action, role, openRole) => {
    mocks.openAgentsPaneTarget.mockReturnValue(true);
    const onOpenSession = vi.fn();

    renderRow({
      presentation: presentation({
        action,
        agent: agent({ role }),
      }),
      onOpenSession,
    });

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("durable-child", openRole);
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
  });

  it("keeps an anomalous promote role=subagent non-clickable without current authority", () => {
    const onOpenSession = vi.fn();

    const { container } = renderRow({
      presentation: presentation({
        action: "promote_subagent",
        agent: agent({ role: "subagent" }),
      }),
      onOpenSession,
    });

    expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("keeps a promoted current root on ordinary navigation despite historical subagent output", () => {
    upsertDirectoryEntry(
      "client-session:promoted",
      "durable-child",
      { kind: "root" },
      "Schema audit",
    );
    useSessionDirectoryStore.getState().markSessionPromoted(
      ["durable-child", "client-session:promoted"],
      "workspace-1",
    );
    const onOpenSession = vi.fn();

    renderRow({
      presentation: presentation({
        action: "open_subagent",
        agent: agent({ role: "subagent" }),
      }),
      onOpenSession,
    });

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("client-session:promoted", "generic");
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it.each(["cowork_child", "review_child", "linked_child"] as const)(
    "keeps a current-workspace %s on the linked-session fallback",
    (kind) => {
      mocks.openAgentsPaneTarget.mockReturnValue(true);
      upsertDirectoryEntry("client-child", "durable-child", {
        kind,
        parentSessionId: "durable-parent",
        relation: kind === "cowork_child"
          ? "cowork"
          : kind === "review_child"
            ? "review"
            : "handoff",
        workspaceId: "workspace-1",
      }, "Schema audit");
      const onOpenSession = vi.fn();

      renderRow({
        presentation: presentation({
          agent: agent({
            parentSessionId: null,
            workspaceId: null,
            role: null,
          }),
        }),
        onOpenSession,
      });

      fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
      expect(onOpenSession).toHaveBeenCalledWith("client-child", "linked-child");
      expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
    },
  );

  it("keeps a projected cross-workspace historical subagent non-clickable", () => {
    mocks.openAgentsPaneTarget.mockReturnValue(true);
    mocks.projectedWorkspaceIds.add("workspace-other");
    const onOpenSession = vi.fn();

    const { container } = renderRow({
      presentation: presentation({
        agent: agent({
          workspaceId: "workspace-other",
          parentSessionId: "other-parent",
          role: "subagent",
        }),
      }),
      onOpenSession,
    });

    expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });
});

function renderRow({
  presentation: rowPresentation,
  onOpenSession,
}: {
  presentation: AgentOperationsReceiptPresentation;
  onOpenSession: ReturnType<typeof vi.fn>;
}) {
  return render(
    <TranscriptContextProviders
      sessionId="active-main-session"
      onOpenSession={onOpenSession}
      canOpenSession={() => true}
    >
      <AgentOperationsToolActionRow
        presentation={rowPresentation}
        currentWorkspaceId="workspace-1"
      />
    </TranscriptContextProviders>,
  );
}

function presentation(overrides: Partial<AgentOperationsReceiptPresentation> = {})
  : AgentOperationsReceiptPresentation {
  const action: AgentOperationsReceiptAction = overrides.action ?? "open_subagent";
  return {
    source: "workspace",
    action,
    actionLabel: "Opened subagent",
    targetAgentId: "durable-child",
    agent: agent(),
    workspace: null,
    message: null,
    detailLabel: null,
    isRunning: false,
    isFailed: false,
    ...overrides,
  };
}

function agent(overrides: Partial<AgentOperationsAgentTarget> = {})
  : AgentOperationsAgentTarget {
  return {
    runtimeId: "runtime-1",
    sessionId: "durable-child",
    workspaceId: "workspace-1",
    parentSessionId: "durable-parent",
    title: "Schema audit",
    role: "subagent",
    presentationStatus: "available",
    executionStatus: "idle",
    closed: false,
    ...overrides,
  };
}

function upsertDirectoryEntry(
  sessionId: string,
  materializedSessionId: string,
  sessionRelationship: SessionRelationship,
  title: string,
) {
  useSessionDirectoryStore.getState().upsertEntry({
    sessionId,
    materializedSessionId,
    workspaceId: "workspace-1",
    agentKind: "codex",
    title,
    sessionRelationship,
  });
}
