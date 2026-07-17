import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createTranscriptState,
  reduceEvents,
} from "@anyharness/sdk";
import type {
  SessionEventEnvelope,
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildTurnPresentation,
} from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import {
  toolItem,
} from "@proliferate/product-domain/chats/transcript/transcript-presentation-test-fixtures";
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
