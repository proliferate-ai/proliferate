// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  createTranscriptState,
  reduceEvents,
} from "@anyharness/sdk";
import type {
  SessionEventEnvelope,
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTurnPresentation,
} from "#product/domain/chats/transcript/transcript-presentation";
import {
  toolItem,
} from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import claudeFixtureJson from "../../../../../../../../fixtures/contracts/native-subagent-transcript/claude.json";
import codexFixtureJson from "../../../../../../../../fixtures/contracts/native-subagent-transcript/codex.json";
import {
  TranscriptAgentGroupBlock,
} from "#product/components/workspace/chat/transcript/TranscriptAgentGroupBlock";
import {
  TranscriptTreeNode,
} from "#product/components/workspace/chat/transcript/TranscriptTreeNode";

vi.mock("#product/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: vi.fn() }),
}));

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

vi.mock("#product/components/workspace/chat/tool-calls/ToolFileChip", () => ({
  ToolFileChip: ({ basename }: { basename: string }) => createElement("span", null, basename),
}));

vi.mock("#product/components/content/ui/HighlightedCodeBlock", () => ({
  HighlightedCodeBlock: ({ code }: { code: string }) => createElement("pre", null, code),
}));

vi.mock("#product/components/workspace/chat/transcript/ConnectedProposedPlanItem", () => ({
  ConnectedProposedPlanItem: () => null,
}));

vi.mock("#product/components/workspace/chat/transcript/SessionErrorItem", () => ({
  SessionErrorItem: () => null,
}));

vi.mock("#product/components/workspace/chat/transcript/UserMessage", () => ({
  UserMessage: () => null,
}));

vi.mock("#product/hooks/ui/native/use-native-context-menu", () => ({
  useNativeContextMenu: () => ({
    onContextMenuCapture: vi.fn(),
    showNativeMenu: vi.fn(),
  }),
  useNativeMenu: () => ({ showNativeMenu: vi.fn() }),
}));

type NativeSubagentFixture = {
  provider: "claude" | "codex";
  sessionId: string;
  turnId: string;
  parentId: string;
  childIds: string[];
  events: SessionEventEnvelope[];
};

const fixtures = {
  claude: claudeFixtureJson as unknown as NativeSubagentFixture,
  codex: codexFixtureJson as unknown as NativeSubagentFixture,
};

afterEach(cleanup);

describe("TranscriptAgentGroupBlock muted status lines", () => {
  // Design Handoff — MODIFIED `SubagentLaunchLedger`; Delivery Spec —
  // Background Work Slice 1, rung R4, acceptance line 52: "the two muted
  // transcript status lines no longer render." (A third — `Creating` — was
  // also retired; see the handoff's exact three-state list.)
  it("never shows Creating/Running in background/Completed in background once expanded", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("native-task", "turn-1", 1, "subagent", "completed"),
      title: "Inspect the repository",
      nativeToolName: "Task",
      rawInput: { run_in_background: true, prompt: "Inspect the transcript pipeline" },
      rawOutput: {
        isAsync: true,
        agentId: "agent-1",
        outputFile: "/tmp/task.output",
        _anyharness: { backgroundWork: { trackerKind: "claude_async_agent", state: "pending" } },
      },
    };
    const childItem: ToolCallItem = toolItem("child-tool", "turn-1", 2, "other", "completed");
    transcript.itemsById[item.itemId] = item;
    transcript.itemsById[childItem.itemId] = childItem;

    const { getByText, container } = render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [childItem.itemId],
        transcript,
        childrenByParentId: new Map([[item.itemId, [childItem.itemId]]]),
        renderChild: () => null,
      }),
    );

    fireEvent.click(getByText("Creating subagent"));

    // The header verb itself is allowed to read "Creating subagent" — it is
    // the retired *status line* (rendered on its own, muted, below the
    // header) that must be gone.
    expect(container.textContent).not.toContain("Running in background");
    expect(container.textContent).not.toContain("Completed in background");
    expect(container.textContent).not.toContain("View initial prompt");
  });

  it("still shows the non-retired status lines (e.g. Launch failed) once expanded", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("native-task-failed", "turn-1", 1, "subagent", "failed"),
      title: "Inspect the repository",
      nativeToolName: "Task",
      rawInput: { prompt: "Inspect the transcript pipeline" },
    };
    transcript.itemsById[item.itemId] = item;

    const { getByText } = render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [],
        transcript,
        childrenByParentId: new Map(),
        renderChild: () => null,
      }),
    );

    fireEvent.click(getByText("Subagent launch failed"));

    expect(getByText("Launch failed")).not.toBeNull();
  });
});

describe.each(["in_progress", "completed"] as const)(
  "TranscriptAgentGroupBlock %s",
  (status) => {
    it("renders the durable native subagent row", () => {
      const transcript = createTranscriptState("session-1");
      const item: ToolCallItem = {
        ...toolItem("native-task", "turn-1", 1, "subagent", status),
        title: "Inspect the repository",
        nativeToolName: "Task",
        rawInput: { prompt: "Inspect the transcript pipeline" },
        rawOutput: status === "completed"
          ? { summary: "Transcript pipeline inspected." }
          : undefined,
      };
      transcript.itemsById[item.itemId] = item;

      const html = renderToStaticMarkup(
        createElement(TranscriptAgentGroupBlock, {
          item,
          childIds: [],
          transcript,
          childrenByParentId: new Map(),
          renderChild: () => null,
        }),
      );

      expect(html).not.toBe("");
      expect(html).toContain("Inspect the repository");
    });
  },
);

describe("TranscriptAgentGroupBlock onOpenSubagent (native routing)", () => {
  // Delivery Spec — Background Work Slice 1, rung R4 fix-forward: the
  // native subagent's transcript block must click-open BackgroundWorkPane's
  // subagent detail, correlated via the same `ToolBackgroundWorkMetadata`
  // agentId `findSubagentLaunchItem` already reads in reverse.
  function backgroundWorkItem(agentId: string): ToolCallItem {
    return {
      ...toolItem("native-task", "turn-1", 1, "subagent", "in_progress"),
      title: "Inspect the repository",
      nativeToolName: "Task",
      rawInput: { run_in_background: true, prompt: "Inspect the transcript pipeline" },
      rawOutput: {
        isAsync: true,
        agentId,
        outputFile: "/tmp/task.output",
        _anyharness: { backgroundWork: { trackerKind: "claude_async_agent", state: "pending" } },
      },
    };
  }

  it("calls onOpenSubagent with the correct subagent id when the header is clicked", () => {
    const transcript = createTranscriptState("session-1");
    const item = backgroundWorkItem("agent-42");
    transcript.itemsById[item.itemId] = item;
    const onOpenSubagent = vi.fn();

    const { getByText } = render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [],
        transcript,
        childrenByParentId: new Map(),
        renderChild: () => null,
        onOpenSubagent,
      }),
    );

    fireEvent.click(getByText("Creating subagent"));

    expect(onOpenSubagent).toHaveBeenCalledTimes(1);
    expect(onOpenSubagent).toHaveBeenCalledWith("agent-42");
  });

  it("still allows expand/collapse via the chevron when onOpenSubagent is wired", () => {
    const transcript = createTranscriptState("session-1");
    const item = backgroundWorkItem("agent-7");
    const childItem: ToolCallItem = toolItem("child-tool", "turn-1", 2, "other", "completed");
    transcript.itemsById[item.itemId] = item;
    transcript.itemsById[childItem.itemId] = childItem;
    const onOpenSubagent = vi.fn();

    const { getByRole, queryByText } = render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [childItem.itemId],
        transcript,
        childrenByParentId: new Map([[item.itemId, [childItem.itemId]]]),
        renderChild: () => null,
        onOpenSubagent,
      }),
    );

    // The header itself now opens the pane, not the disclosure — expanding
    // must go through the dedicated chevron control instead.
    expect(queryByText("Launch failed")).toBeNull();
    fireEvent.click(getByRole("button", { name: "Expand subagent details" }));

    expect(onOpenSubagent).not.toHaveBeenCalled();
    expect(getByRole("button", { name: "Collapse subagent details" })).not.toBeNull();
  });

  it("does not get the pane-opening affordance when rawOutput has no background metadata", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("native-task-no-meta", "turn-1", 1, "subagent", "failed"),
      title: "Inspect the repository",
      nativeToolName: "Task",
      rawInput: { prompt: "Inspect the transcript pipeline" },
    };
    transcript.itemsById[item.itemId] = item;
    const onOpenSubagent = vi.fn();

    const { getByText, queryByRole } = render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [],
        transcript,
        childrenByParentId: new Map(),
        renderChild: () => null,
        onOpenSubagent,
      }),
    );

    // No chevron affordance: this block has no background-work correlation
    // for onOpenSubagent to resolve an id from.
    expect(queryByRole("button", { name: "Expand subagent details" })).toBeNull();

    // Falls back to byte-identical expand-on-click behavior.
    fireEvent.click(getByText("Subagent launch failed"));

    expect(onOpenSubagent).not.toHaveBeenCalled();
    expect(getByText("Launch failed")).not.toBeNull();
  });
});

describe("native subagent transcript tree rendering", () => {
  it("renders Codex collaboration activity as a tool, not another spawn", () => {
    const { fixture, transcript, childrenByParentId } = fixtureTree("codex");
    const html = renderNodes(fixture.childIds, transcript, childrenByParentId);

    expect(html).toContain("send_input");
    expect(html).toContain("Send follow-up to child");
    expect(html).not.toContain("Subagent created");
    expect(html).not.toContain("Creating subagent");
  });

  it("renders Claude child prose, reasoning, and file activity", () => {
    const { fixture, transcript, childrenByParentId } = fixtureTree("claude");
    const html = renderNodes(fixture.childIds, transcript, childrenByParentId);

    expect(html).toContain("Inspecting the transcript pipeline.");
    expect(html).toContain("Checking reducer ordering.");
    expect(html).toContain("transcript.ts");
  });

  it.each(["claude", "codex"] as const)(
    "routes the %s parent through the durable subagent group",
    (provider) => {
      const { fixture, transcript, childrenByParentId } = fixtureTree(provider);
      const html = renderNodes([fixture.parentId], transcript, childrenByParentId);

      expect(html).toContain("Subagent created");
      expect(html).toContain("Inspect the repository");
    },
  );
});

function fixtureTree(provider: keyof typeof fixtures): {
  fixture: NativeSubagentFixture;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
} {
  const fixture = fixtures[provider];
  const transcript = reduceEvents(fixture.events, fixture.sessionId, { replayMode: true });
  const turn = transcript.turnsById[fixture.turnId];
  if (!turn) {
    throw new Error(`missing fixture turn ${fixture.turnId}`);
  }
  const { childrenByParentId } = buildTurnPresentation(turn, transcript);
  return { fixture, transcript, childrenByParentId };
}

function renderNodes(
  itemIds: readonly string[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
): string {
  return renderToStaticMarkup(
    createElement(
      "div",
      null,
      ...itemIds.map((itemId) => createElement(TranscriptTreeNode, {
        key: itemId,
        itemId,
        transcript,
        childrenByParentId,
        workspaceId: "workspace-1",
        onOpenArtifact: () => {},
      })),
    ),
  );
}
