// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reduceEvents } from "@anyharness/sdk";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import { TranscriptContextProviders } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { TranscriptToolCallItemBlock } from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock";
import {
  agentView,
  buildDirectoryState,
  renderWithProductHost as render,
  renderWithProductHostToStaticMarkup as renderToStaticMarkup,
  TestResizeObserver,
  workspaceTool,
  type AgentOperationsTranscriptFixture,
} from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock.test-fixtures";
import fixtureJson from "../../../../../../../../fixtures/contracts/agent-operations-transcript/v1.json";
import { delegatedWorkVisualIdentity } from "#product/lib/domain/delegated-work/identity";
import { solidSealGeometry } from "#product/lib/domain/delegated-work/solid-seal";
import { deriveAgentOperationsReceiptPresentation } from "#product/domain/chats/tools/agent-operations-tool-presentation";
import { buildTurnPresentation } from "#product/domain/chats/transcript/transcript-presentation";

const fixture = fixtureJson as unknown as AgentOperationsTranscriptFixture;
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

describe("TranscriptToolCallItemBlock", () => {
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

  it("collapses long file-change groups in chat", () => {
    const item = toolCallItem({
      semanticKind: "file_change",
      contentParts: Array.from({ length: 5 }, (_, index) => ({
        type: "file_change",
        operation: "edit",
        path: `/Users/pablo/proliferate/src/file-${index}.ts`,
        workspacePath: `src/file-${index}.ts`,
        basename: `file-${index}.ts`,
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
      })),
    });

    const html = renderToStaticMarkup(
      createElement(TranscriptToolCallItemBlock, {
        item,
        workspaceId: "workspace-1",
        onOpenArtifact: () => {},
      }),
    );

    expect(html).toContain("src/file-0.ts");
    expect(html).toContain("src/file-2.ts");
    expect(html).not.toContain("src/file-3.ts");
    expect(html).toContain("Show 2 more");
  });

  it("keeps structured-only Workspace reads expandable in live and replay rendering", () => {
    const liveItem = workspaceTool("list_agents", {
      rawInput: {},
      rawOutput: { agents: [] },
    });
    const live = render(
      <TranscriptToolCallItemBlock
        item={liveItem}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
      />,
    );

    fireEvent.click(live.container.querySelector("[data-tool-action-row]")!);
    expect(screen.getByText(/"agents": \[\]/)).toBeTruthy();
    live.unmount();

    const replay = reduceEvents(fixture.events, fixture.sessionId, { replayMode: true });
    const turn = replay.turnsById[fixture.turnId];
    if (!turn) throw new Error(`missing replay turn ${fixture.turnId}`);
    expect(buildTurnPresentation(turn, replay).displayBlocks).toEqual([
      {
        kind: "subagent_creations",
        blockId: fixture.createIds[0],
        itemIds: fixture.createIds,
      },
      { kind: "item", itemId: fixture.sendId },
      {
        kind: "collapsed_actions",
        blockId: `${fixture.readId}-${fixture.readId}`,
        itemIds: [fixture.readId],
      },
      { kind: "item", itemId: "assistant-final" },
    ]);
    const completedFixtureItems = new Map(
      fixture.events.flatMap((envelope) =>
        envelope.event.type === "item_completed" && envelope.itemId
          ? [[envelope.itemId, envelope.event.item] as const]
          : []
      ),
    );
    for (const itemId of [...fixture.createIds, fixture.sendId]) {
      const replayReceipt = replay.itemsById[itemId];
      const liveReceipt = completedFixtureItems.get(itemId);
      expect(replayReceipt?.kind).toBe("tool_call");
      expect(liveReceipt?.kind).toBe("tool_invocation");
      expect(deriveAgentOperationsReceiptPresentation(replayReceipt as ToolCallItem)).toEqual(
        deriveAgentOperationsReceiptPresentation({
          ...replayReceipt,
          rawInput: liveReceipt && "rawInput" in liveReceipt ? liveReceipt.rawInput : null,
          rawOutput: liveReceipt && "rawOutput" in liveReceipt ? liveReceipt.rawOutput : null,
        } as ToolCallItem),
      );
    }
    const replayItem = replay.itemsById[fixture.readId];
    if (replayItem?.kind !== "tool_call") {
      throw new Error(`missing replay tool item ${fixture.readId}`);
    }
    const replayRender = render(
      <TranscriptToolCallItemBlock
        item={replayItem}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
      />,
    );

    fireEvent.click(replayRender.container.querySelector("[data-tool-action-row]")!);
    expect(screen.getByText(/"agents": \[\]/)).toBeTruthy();
  });

  it("keeps malformed or absent Workspace read output on the non-expandable fallback", () => {
    const item = workspaceTool("list_agents", {
      rawInput: {},
      rawOutput: "not-json",
      contentParts: [],
    });
    const { container } = render(
      <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    expect(container.querySelector("[data-tool-action-row]")?.getAttribute("role")).toBeNull();
    expect(container.querySelector("[data-tool-action-row]")?.getAttribute("aria-expanded"))
      .toBeNull();
  });

  it("renders an outgoing send receipt on the left with directory-resolved identity", () => {
    mocks.directoryEntries["agent-session-2"] = {
      title: "Schema audit",
      workspaceId: "workspace-1",
      activity: { transcriptTitle: null },
      sessionRelationship: { kind: "subagent_child" },
    };
    const item = workspaceTool("send_message", {
      rawInput: { agentId: "agent-id-not-a-session", message: "Keep  two\nlines exactly." },
      rawOutput: {
        target: { runtimeId: "runtime-1", sessionId: "agent-session-2" },
        queueSeq: 7,
        status: "durably_queued",
      },
    });

    const { container } = render(
      <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    const receipt = container.querySelector("[data-agent-message-receipt]");
    expect(receipt?.getAttribute("data-direction")).toBe("outgoing");
    expect(receipt?.textContent).toContain("Schema audit");
    expect(receipt?.textContent).toContain("messaged");
    expect(receipt?.textContent).not.toContain("agent-id-not-a-session");
  });

  it("keeps detailed workspace creation facts inspectable and opens the workspace", () => {
    const item = workspaceTool("create_workspace", {
      rawInput: { repositoryId: "repo-1", creationMode: "worktree", branch: "main" },
      rawOutput: {
        workspace: {
          identity: { runtimeId: "runtime-1", workspaceId: "workspace-2" },
          repositoryId: "repo-root-opaque",
          kind: "worktree",
          surface: "standard",
          path: "/runtime/worktrees/agent-ops",
          displayName: "Agent ops",
          currentBranch: "agent-ops",
          originalBranch: "main",
          lifecycleState: "active",
          createdAt: "2026-08-10T01:00:00Z",
          updatedAt: "2026-08-10T01:00:01Z",
          internalReference: "fact-only-in-details",
        },
        creationMode: "worktree",
      },
    });

    render(
      <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    expect(screen.getByText("Created workspace")).toBeTruthy();
    expect(screen.getByText("Agent ops")).toBeTruthy();
    expect(screen.getByText("· worktree from agent-ops ·")).toBeTruthy();
    expect(screen.queryByText(/fact-only-in-details/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show agent operation details" }));
    expect(screen.getByText(/fact-only-in-details/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(mocks.selectWorkspace).toHaveBeenCalledWith("workspace-2", {
      force: true,
      knownWorkspace: expect.objectContaining({
        id: "workspace-2",
        repoRootId: "repo-root-opaque",
        path: "/runtime/worktrees/agent-ops",
      }),
    });
  });

  it("dims a successful Close glyph once and never dims a failed Close", () => {
    const closed = workspaceTool("close_subagent", {
      rawOutput: agentView({
        status: { presentation: "closed", execution: "closed", hasLiveActor: false },
      }),
    });
    const { unmount } = render(
      <TranscriptToolCallItemBlock item={closed} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    expect(screen.getByText("closed")).toBeTruthy();
    expect(screen.getByRole("img", { name: /schema audit.* identity/i }).style.opacity).toBe("0.45");
    unmount();

    const failed = workspaceTool("close_subagent", {
      status: "failed",
      rawOutput: agentView(),
    });
    render(
      <TranscriptToolCallItemBlock item={failed} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    expect(screen.getByText("failed to close")).toBeTruthy();
    expect(screen.queryByText("closed")).toBeNull();
    expect(screen.getByRole("img", { name: /schema audit.* identity/i }).style.opacity).toBe("1");
  });

  it("opens a strictly correlated promoted agent through its client key", () => {
    mocks.directoryEntries["client-session:promoted"] = {
      sessionId: "client-session:promoted",
      materializedSessionId: "agent-session-1",
      title: "Schema audit",
      workspaceId: "workspace-1",
      activity: { transcriptTitle: null },
      sessionRelationship: { kind: "root" },
    };
    const item = workspaceTool("promote_subagent", {
      rawOutput: agentView({
        role: "ordinary",
        parent: null,
        workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
      }),
    });
    const onOpenSession = vi.fn();

    render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={onOpenSession}>
        <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("client-session:promoted", "generic");
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();

    const expectedGeometry = solidSealGeometry(
      delegatedWorkVisualIdentity("agent-session-1").glyphSeedHash,
    );
    const notch = document.querySelector("[data-solid-seal-notch]");
    expect(notch?.getAttribute("cx")).toBe(String(expectedGeometry.notchX));
    expect(notch?.getAttribute("cy")).toBe(String(expectedGeometry.notchY));
  });

  it("withholds navigation from a create result that disagrees with the caller workspace", () => {
    mocks.directoryEntries["client-session:pending"] = {
      sessionId: "client-session:pending",
      materializedSessionId: "agent-session-new",
      title: "Schema audit",
      workspaceId: "workspace-other",
      activity: { transcriptTitle: null },
      sessionRelationship: { kind: "pending" },
    };
    const item = workspaceTool("create_agent", {
      rawInput: {
        workspaceId: "workspace-other",
        kind: "subagent",
        task: "Schema audit",
      },
      rawOutput: agentView({
        identity: { runtimeId: "runtime-1", sessionId: "agent-session-new" },
        workspace: { runtimeId: "runtime-1", workspaceId: "workspace-other" },
      }),
    });

    render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={vi.fn()}>
        <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />
      </TranscriptContextProviders>,
    );

    expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
  });

  it("routes a same-workspace durable AgentView to Agents without changing the main tab", () => {
    mocks.directoryRelationshipHints["agent-session-1"] = {
      kind: "subagent_child",
      parentSessionId: "parent-session",
      relation: "subagent",
      workspaceId: "workspace-1",
    };
    const item = workspaceTool("resume_agent", { rawOutput: agentView() });
    const onOpenSession = vi.fn();

    render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={onOpenSession}>
        <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: "parent-session",
      childSessionId: "agent-session-1",
      historicalSubagentProvenance: true,
    });
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("withholds cross-workspace navigation until that workspace is projected", () => {
    mocks.projectedWorkspaceIds = new Set(["workspace-1"]);
    const item = workspaceTool("create_agent", {
      rawOutput: agentView({
        identity: { runtimeId: "runtime-1", sessionId: "agent-session-new" },
        workspace: { runtimeId: "runtime-1", workspaceId: "workspace-unprojected" },
      }),
    });

    render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={vi.fn()}>
        <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />
      </TranscriptContextProviders>,
    );

    expect(document.querySelector("[data-agent-identity-chip] svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("renders an unresolved identity-only send without inventing navigation", () => {
    const item = workspaceTool("send_message", {
      rawInput: { agentId: "agent-session-unresolved", message: "Exact message" },
      rawOutput: {
        target: { runtimeId: "runtime-1", sessionId: "agent-session-unresolved" },
        queueSeq: 8,
        status: "durably_queued",
      },
    });

    render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={vi.fn()}>
        <TranscriptToolCallItemBlock item={item} workspaceId="workspace-current" onOpenArtifact={() => {}} />
      </TranscriptContextProviders>,
    );

    expect(document.querySelector("[data-agent-identity-chip]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open .*agent/i })).toBeNull();
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
  });

  it("uses honest failure copy for workspace creation", () => {
    const item = workspaceTool("create_workspace", {
      status: "failed",
      rawOutput: { error: "repository unavailable" },
    });

    render(
      <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    expect(screen.getByText("Failed to create workspace")).toBeTruthy();
    expect(screen.queryByText("Created workspace")).toBeNull();
  });

  it("renders a production-shaped Codex ordinary create with its deterministic glyph", () => {
    const created = agentView({
      identity: { runtimeId: "runtime-1", sessionId: "ordinary-created" },
      role: "ordinary",
      parent: null,
      title: "Ordinary reviewer",
    });
    const item = workspaceTool("create_agent", {
      nativeToolName: null,
      rawInput: {
        server: "workspace",
        tool: "create_agent",
        arguments: { workspaceId: "workspace-1", kind: "ordinary" },
      },
      rawOutput: {
        content: [{ type: "text", text: JSON.stringify(created) }],
        isError: false,
        structuredContent: created,
      },
    });

    const { container } = render(
      <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    expect(container.querySelector("[data-agent-identity-chip] svg")).toBeTruthy();
    expect(container.querySelector("[data-agent-operations-product-mark]")).toBeNull();
    expect(screen.getByText("Ordinary reviewer")).toBeTruthy();
    expect(screen.getByText("created")).toBeTruthy();
  });

  it("keeps a targeted Workspace read foldable while using the agent glyph", () => {
    const item = workspaceTool("get_task_output", {
      rawInput: { agentId: "target-agent", limit: 10 },
      rawOutput: { messages: [{ role: "assistant", text: "Done" }] },
    });

    const { container } = render(
      <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    expect(container.querySelector("[data-solid-seal-notch]")).toBeTruthy();
    expect(container.querySelector("[data-agent-operations-product-mark]")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["in_progress", "failed"] as const)(
    "renders a %s Codex create with the product mark and no invented identity",
    (status) => {
      const item = workspaceTool("create_agent", {
        status,
        nativeToolName: null,
        rawInput: {
          server: "proliferate_workspace",
          tool: "create_agent",
          arguments: { workspaceId: "workspace-1", kind: "ordinary" },
        },
        rawOutput: {
          content: [],
          isError: status === "failed",
          structuredContent: agentView(),
        },
      });

      const { container } = render(
        <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
      );

      expect(container.querySelector("[data-agent-operations-product-mark]")).toBeTruthy();
      expect(container.querySelector("[data-agent-identity-chip]")).toBeNull();
    },
  );

  it.each([
    ["create_agent", "created"],
    ["configure_agent", "configured"],
    ["resume_agent", "resumed"],
    ["interrupt_agent", "interrupted"],
    ["close_subagent", "closed"],
    ["open_subagent", "opened"],
    ["promote_subagent", "promoted"],
  ])("renders %s as identity chip before quiet verb", (action, verb) => {
    const item = workspaceTool(action, {
      rawOutput: action === "configure_agent"
        ? { agent: agentView(), applyState: "applied" }
        : agentView(action === "promote_subagent" ? { role: "ordinary" } : {}),
    });
    const { container } = render(
      <TranscriptToolCallItemBlock item={item} workspaceId="workspace-1" onOpenArtifact={() => {}} />,
    );

    const receipt = container.querySelector(`[data-agent-operations-receipt='${action}']`);
    expect(receipt?.textContent?.startsWith(`Schema audit${verb}`)).toBe(true);
  });
});
