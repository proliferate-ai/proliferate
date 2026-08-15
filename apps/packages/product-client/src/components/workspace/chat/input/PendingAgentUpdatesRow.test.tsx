// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingAgentUpdatesRow } from "#product/components/workspace/chat/input/PendingAgentUpdatesRow";
import { derivePendingPromptQueueRows } from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const openWorkspaceSessionMock = vi.hoisted(() => vi.fn());
const openAgentsPaneTargetMock = vi.hoisted(() => vi.fn());
const agentsPaneClassificationOverride = vi.hoisted(() => ({
  value: null as null | "subagent" | "promoted" | "other_relationship" | "unresolved",
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
    classifyAgentsPaneTarget: (target: { childSessionId?: string | null }) => {
      if (agentsPaneClassificationOverride.value) {
        return agentsPaneClassificationOverride.value;
      }
      const promoted = useSessionDirectoryStore.getState().promotedRootSessionIds;
      return target.childSessionId && promoted.has(target.childSessionId)
        ? "promoted"
        : "subagent";
    },
    openAgentsPaneTarget: openAgentsPaneTargetMock,
  }),
}));

function activateMaterializedParent() {
  useSessionDirectoryStore.getState().upsertEntry({
    sessionId: "client-parent",
    materializedSessionId: "parent-durable",
    workspaceId: "workspace-1",
    agentKind: "codex",
    sessionRelationship: { kind: "root" },
  });
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: null,
    workspaceId: "workspace-1",
    initialActiveSessionId: "client-parent",
  });
}

function renderAgentUpdates(
  prompts: Parameters<typeof derivePendingPromptQueueRows>[0],
  completions?: Parameters<typeof derivePendingPromptQueueRows>[1],
) {
  const entry = derivePendingPromptQueueRows(prompts, completions)
    .find((row) => row.kind === "agent_updates");
  if (!entry) {
    throw new Error("Expected an agent-updates row");
  }
  return render(
    <PendingAgentUpdatesRow
      entry={entry}
      directoryBackedAgentNavigation
    />,
  );
}

function renderSubagentWakeAgent({
  childSessionId = "child-durable",
  label = "Schema audit",
}: {
  childSessionId?: string;
  label?: string;
} = {}) {
  renderAgentUpdates([{
    seq: 1,
    text: "hidden update",
    contentParts: [],
    isBeingEdited: false,
    promptProvenance: {
      type: "subagentWake",
      sessionLinkId: "link-child",
      completionId: "completion-child",
      label,
    },
  }], {
    "completion-child": {
      relation: "subagent",
      completionId: "completion-child",
      sessionLinkId: "link-child",
      parentSessionId: "parent-durable",
      childSessionId,
      childTurnId: "turn-child",
      childLastEventSeq: 10,
      outcome: "completed",
      label,
      seq: 11,
      timestamp: "2026-08-11T00:00:00Z",
    },
  });
}

describe("PendingAgentUpdatesRow", () => {
  afterEach(() => {
    cleanup();
    openWorkspaceSessionMock.mockReset();
    openAgentsPaneTargetMock.mockReset();
    agentsPaneClassificationOverride.value = null;
    useSessionDirectoryStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
  });

  it("lets a promoted root override historical wake provenance", () => {
    activateMaterializedParent();
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-promoted",
      materializedSessionId: "promoted-durable",
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: { kind: "root" },
    });
    useSessionDirectoryStore.getState().markSessionPromoted(
      ["promoted-durable", "client-promoted"],
      "workspace-1",
    );
    renderAgentUpdates([{
      seq: 1,
      text: "historical update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-promoted",
        completionId: "completion-promoted",
        label: "Promoted worker",
      },
    }], {
      "completion-promoted": {
        relation: "subagent",
        completionId: "completion-promoted",
        sessionLinkId: "link-promoted",
        parentSessionId: "parent-durable",
        childSessionId: "promoted-durable",
        childTurnId: "turn-promoted",
        childLastEventSeq: 10,
        outcome: "completed",
        label: "Promoted worker",
        seq: 11,
        timestamp: "2026-08-11T00:00:00Z",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /open .*promoted worker/i }));

    expect(openAgentsPaneTargetMock).not.toHaveBeenCalled();
    expect(openWorkspaceSessionMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      sessionId: "client-promoted",
    });
  });

  it("routes durable wake provenance to the exact Agents detail", () => {
    activateMaterializedParent();
    useSessionDirectoryStore.getState().recordRelationshipHint(
      "child-durable",
      {
        kind: "subagent_child",
        parentSessionId: "parent-durable",
        sessionLinkId: "link-child",
        relation: "subagent",
        workspaceId: "workspace-1",
      },
    );
    renderAgentUpdates([{
      seq: 1,
      text: "hidden update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-child",
        completionId: "completion-child",
        label: "Schema audit",
      },
    }], {
      "completion-child": {
        relation: "subagent",
        completionId: "completion-child",
        sessionLinkId: "link-child",
        parentSessionId: "parent-durable",
        childSessionId: "child-durable",
        childTurnId: "turn-child",
        childLastEventSeq: 10,
        outcome: "completed",
        label: "Schema audit",
        seq: 11,
        timestamp: "2026-08-11T00:00:00Z",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));

    expect(openAgentsPaneTargetMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: "parent-durable",
      childSessionId: "child-durable",
      historicalSubagentProvenance: true,
    });
    expect(openWorkspaceSessionMock).not.toHaveBeenCalled();
    expect(useSessionDirectoryStore.getState()
      .relationshipHintsBySessionId["child-durable"]).toMatchObject({
      kind: "subagent_child",
      parentSessionId: "parent-durable",
      sessionLinkId: "link-child",
      workspaceId: "workspace-1",
    });
  });

  it("keeps historical wake provenance non-clickable without current workspace authority", () => {
    activateMaterializedParent();
    renderAgentUpdates([{
      seq: 1,
      text: "historical update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-unresolved",
        completionId: "completion-unresolved",
        label: "Unresolved worker",
      },
    }], {
      "completion-unresolved": {
        relation: "subagent",
        completionId: "completion-unresolved",
        sessionLinkId: "link-unresolved",
        parentSessionId: "parent-durable",
        childSessionId: "unresolved-durable",
        childTurnId: "turn-unresolved",
        childLastEventSeq: 10,
        outcome: "completed",
        label: "Unresolved worker",
        seq: 11,
        timestamp: "2026-08-11T00:00:00Z",
      },
    });

    expect(screen.queryByRole("button", { name: /open .*unresolved worker/i })).toBeNull();
    expect(document.querySelector("[data-pending-agent-glyph='unresolved-durable']")
      ?.hasAttribute("data-agent-navigation-unresolved")).toBe(true);
  });

  it.each(["matching", "mismatched"] as const)(
    "treats pending %s workspace authority without inventing an ordinary fallback",
    (authority) => {
      activateMaterializedParent();
      useSessionDirectoryStore.getState().upsertEntry({
        sessionId: "client-pending-child",
        materializedSessionId: "child-durable",
        workspaceId: authority === "matching" ? "workspace-1" : "workspace-other",
        agentKind: "codex",
        sessionRelationship: { kind: "pending" },
      });
      renderSubagentWakeAgent();

      if (authority === "mismatched") {
        expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
        expect(openAgentsPaneTargetMock).not.toHaveBeenCalled();
        expect(openWorkspaceSessionMock).not.toHaveBeenCalled();
        return;
      }

      fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
      expect(openAgentsPaneTargetMock).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        parentSessionId: "parent-durable",
        childSessionId: "child-durable",
        historicalSubagentProvenance: true,
      });
      expect(openWorkspaceSessionMock).not.toHaveBeenCalled();
    },
  );

  it("keeps a durable cross-workspace subagent on ordinary workspace navigation", () => {
    activateMaterializedParent();
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-cross-workspace",
      materializedSessionId: "child-durable",
      workspaceId: "workspace-other",
      agentKind: "codex",
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: "other-parent",
        relation: "subagent",
        workspaceId: "workspace-other",
      },
    });
    renderSubagentWakeAgent();

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));

    expect(openAgentsPaneTargetMock).not.toHaveBeenCalled();
    expect(openWorkspaceSessionMock).toHaveBeenCalledWith({
      workspaceId: "workspace-other",
      sessionId: "client-cross-workspace",
    });
  });

  it("does not fall through when a pane-qualified click becomes unresolved", () => {
    activateMaterializedParent();
    useSessionDirectoryStore.getState().recordRelationshipHint("child-durable", {
      kind: "subagent_child",
      parentSessionId: "parent-durable",
      sessionLinkId: "link-child",
      relation: "subagent",
      workspaceId: "workspace-1",
    });
    agentsPaneClassificationOverride.value = "unresolved";
    renderSubagentWakeAgent();

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));

    expect(openAgentsPaneTargetMock).not.toHaveBeenCalled();
    expect(openWorkspaceSessionMock).not.toHaveBeenCalled();
  });

  it("uses typed directory provenance while preserving cowork navigation", () => {
    activateMaterializedParent();
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-child",
      materializedSessionId: "child-durable",
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: {
        kind: "linked_child",
        parentSessionId: "parent-durable",
        relation: "subagent",
        workspaceId: "workspace-1",
      },
    });
    const rendered = renderAgentUpdates([{
      seq: 1,
      text: "directory-backed update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "agentSession",
        sourceSessionId: "child-durable",
        label: "Directory child",
      },
    }]);

    fireEvent.click(screen.getByRole("button", { name: /open .*directory child/i }));
    expect(openAgentsPaneTargetMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: "parent-durable",
      childSessionId: "child-durable",
      historicalSubagentProvenance: false,
    });

    rendered.unmount();
    openAgentsPaneTargetMock.mockClear();
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-cowork",
      materializedSessionId: "cowork-durable",
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: {
        kind: "cowork_child",
        parentSessionId: "parent-durable",
        relation: "cowork_coding_session",
        workspaceId: "workspace-1",
      },
    });
    renderAgentUpdates([{
      seq: 2,
      text: "cowork update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "agentSession",
        sourceSessionId: "cowork-durable",
        label: "Coding pass",
      },
    }]);

    fireEvent.click(screen.getByRole("button", { name: /open .*coding pass/i }));
    expect(openAgentsPaneTargetMock).not.toHaveBeenCalled();
    expect(openWorkspaceSessionMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      sessionId: "client-cowork",
    });
  });

  it("keeps a definite subagent non-clickable without a materialized parent", () => {
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-parent",
      materializedSessionId: null,
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: { kind: "pending" },
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: "workspace-1",
      initialActiveSessionId: "client-parent",
    });
    renderAgentUpdates([{
      seq: 1,
      text: "hidden update",
      contentParts: [],
      isBeingEdited: false,
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-child",
        completionId: "completion-child",
        label: "Schema audit",
      },
    }], {
      "completion-child": {
        relation: "subagent",
        completionId: "completion-child",
        sessionLinkId: "link-child",
        parentSessionId: "parent-durable",
        childSessionId: "child-durable",
        childTurnId: "turn-child",
        childLastEventSeq: 10,
        outcome: "completed",
        label: "Schema audit",
        seq: 11,
        timestamp: "2026-08-11T00:00:00Z",
      },
    });

    expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
    expect(document.querySelector("[data-pending-agent-glyph='child-durable']")
      ?.hasAttribute("data-agent-navigation-unresolved")).toBe(true);
  });
});
