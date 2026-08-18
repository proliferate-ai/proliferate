// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import { TranscriptContextProviders } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { TranscriptToolCallItemBlock } from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock";
import {
  agentView,
  buildDirectoryState,
  renderWithProductHost as render,
  TestResizeObserver,
  workspaceTool,
} from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock.test-fixtures";

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  openWorkspaceSession: vi.fn(),
  openAgentsPaneTarget: vi.fn(),
  directoryEntries: {} as Record<string, unknown>,
  directoryRelationshipHints: {} as Record<string, unknown>,
  promotedRootSessionIds: new Set<string>(),
  promotedRootWorkspaceIdBySessionId: {} as Record<string, string | null>,
  projectedWorkspaceIds: new Set<string>(),
}));

vi.mock("#product/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-navigation-actions", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("#product/hooks/agents/workflows/use-agents-pane-navigation-actions")
  >(),
  useAgentsPaneNavigationActions: () => ({
    classifyAgentsPaneTarget: (target: { childSessionId?: string | null }) =>
      target.childSessionId && mocks.promotedRootSessionIds.has(target.childSessionId)
        ? "promoted" as const
        : "subagent" as const,
    openAgentsPaneTarget: mocks.openAgentsPaneTarget,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      allWorkspaces: [...mocks.projectedWorkspaceIds].map((id) => ({ id })),
    },
  }),
}));

vi.mock("#product/stores/sessions/session-directory-store", () => {
  const directoryState = () => buildDirectoryState(
    mocks.directoryEntries,
    mocks.promotedRootSessionIds,
    mocks.promotedRootWorkspaceIdBySessionId,
    mocks.directoryRelationshipHints,
  );
  const useSessionDirectoryStore = (selector: (state: unknown) => unknown) => selector(
    directoryState(),
  );
  useSessionDirectoryStore.getState = () => ({
    ...directoryState(),
    markSessionPromoted: (sessionIds: readonly string[], workspaceId: string | null) => {
      for (const sessionId of sessionIds) {
        mocks.promotedRootSessionIds.add(sessionId);
        mocks.promotedRootWorkspaceIdBySessionId[sessionId] = workspaceId;
      }
    },
    recordRelationshipHint: vi.fn(),
  });
  return { useSessionDirectoryStore };
});

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: ({ rawPath }: { rawPath: string }) => ({
    reference: {
      rawPath,
      path: rawPath,
      line: null,
      column: null,
      absolutePath: `/repo/${rawPath}`,
      workspacePath: rawPath,
    },
    openTargets: [],
    canOpenInSidebar: true,
    canOpenExternal: true,
    copyPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: vi.fn(),
    openPrimary: vi.fn(),
    openWithTarget: vi.fn(),
    reveal: vi.fn(),
  }),
}));

describe("TranscriptToolCallItemBlock semantic title receipts", () => {
  beforeEach(() => {
    mocks.selectWorkspace.mockReset();
    mocks.openWorkspaceSession.mockReset();
    mocks.openAgentsPaneTarget.mockReset();
    mocks.openAgentsPaneTarget.mockReturnValue(true);
    mocks.directoryEntries = {};
    mocks.directoryRelationshipHints = {};
    mocks.promotedRootSessionIds = new Set();
    mocks.promotedRootWorkspaceIdBySessionId = {};
    mocks.projectedWorkspaceIds = new Set(["workspace-1", "workspace-other"]);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["completed create", "lifecycle", "directory-backed send_message"] as const)(
    "renders the semantic AnyHarness title for a %s receipt",
    (receiptKind) => {
      const semanticTitle = "Inspect the replay boundary";
      const providerPrefix = "System instruction from AnyHarness, not user content:";
      let item: ToolCallItem;

      if (receiptKind === "completed create") {
        item = workspaceTool("create_agent", {
          rawInput: {
            workspaceId: "workspace-1",
            kind: "subagent",
            task: "  Inspect\n the replay boundary  ",
          },
          rawOutput: agentView({ title: semanticTitle }),
        });
      } else if (receiptKind === "lifecycle") {
        item = workspaceTool("resume_agent", {
          rawInput: { agentId: "agent-session-1" },
          rawOutput: agentView({ title: semanticTitle }),
        });
      } else {
        mocks.directoryEntries["client-session:message-target"] = {
          sessionId: "client-session:message-target",
          materializedSessionId: "agent-session-1",
          title: semanticTitle,
          workspaceId: "workspace-1",
          activity: { transcriptTitle: null },
          sessionRelationship: {
            kind: "subagent_child",
            parentSessionId: "parent-session",
            relation: "subagent",
            workspaceId: "workspace-1",
          },
        };
        item = workspaceTool("send_message", {
          rawInput: { agentId: "agent-session-1", message: "Continue the audit" },
          rawOutput: {
            target: { runtimeId: "runtime-1", sessionId: "agent-session-1" },
            queueSeq: 8,
            status: "durably_queued",
          },
        });
      }

      render(
        <TranscriptContextProviders sessionId="parent-session" onOpenSession={vi.fn()}>
          <TranscriptToolCallItemBlock
            item={item}
            workspaceId="workspace-1"
            onOpenArtifact={() => {}}
          />
        </TranscriptContextProviders>,
      );

      expect(screen.getByText(semanticTitle)).toBeTruthy();
      expect(screen.queryByText("Agent")).toBeNull();
      expect(screen.queryByText(new RegExp(providerPrefix))).toBeNull();
    },
  );
});
