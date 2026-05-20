// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import { TranscriptContextProviders } from "./TranscriptContexts";
import { TranscriptToolCallItemBlock } from "./TranscriptToolCallItemBlock";

vi.mock("@/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

vi.mock("@/hooks/workspaces/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/files/use-file-reference-actions", () => ({
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
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
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

  it("renders subagent status checks as delegated agent receipts", () => {
    const item = toolCallItem({
      semanticKind: "subagent",
      nativeToolName: "mcp__subagents__get_subagent_status",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        childSessionId: "child-123",
        label: "API Surface Check",
        status: "running",
      },
    });

    const html = renderToStaticMarkup(
      createElement(TranscriptToolCallItemBlock, {
        item,
        workspaceId: "workspace-1",
        onOpenArtifact: () => {},
      }),
    );

    expect(html).toContain("Checked subagent");
    expect(html).toContain("API Surface Check");
    expect(html).toContain("Working");
    expect(html).toContain("text-[length:var(--text-chat)]");
  });

  it("renders subagent event reads as delegated agent receipts", () => {
    const item = toolCallItem({
      semanticKind: "subagent",
      nativeToolName: "mcp__subagents__read_subagent_events",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        childSessionId: "child-123",
        label: "API Surface Check",
        events: [{ id: "event-1" }, { id: "event-2" }],
      },
      contentParts: [{
        type: "tool_result_text",
        text: "{\"events\":[{\"id\":\"event-1\"},{\"id\":\"event-2\"}]}",
      }],
    });

    const html = renderToStaticMarkup(
      createElement(TranscriptToolCallItemBlock, {
        item,
        workspaceId: "workspace-1",
        onOpenArtifact: () => {},
      }),
    );

    expect(html).toContain("Read subagent events");
    expect(html).toContain("API Surface Check");
    expect(html).toContain("2 events");
    expect(html).not.toContain("event-1");
  });

  it("does not expose raw subagent ids as receipt titles", () => {
    const item = toolCallItem({
      semanticKind: "subagent",
      nativeToolName: "mcp__subagents__get_subagent_status",
      rawOutput: {
        subagentId: "subagent_abc123",
        status: "idle",
      },
    });

    const html = renderToStaticMarkup(
      createElement(TranscriptToolCallItemBlock, {
        item,
        workspaceId: "workspace-1",
        onOpenArtifact: () => {},
      }),
    );

    expect(html).toContain("Checked subagent");
    expect(html).toContain("Subagent");
    expect(html).not.toContain("subagent_abc123");
  });

  it("renders subagent close receipts without an open-session affordance", () => {
    const item = toolCallItem({
      semanticKind: "subagent",
      nativeToolName: "mcp__subagents__close_subagent",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        childSessionId: "child-123",
        label: "API Surface Check",
        closed: true,
      },
    });

    const html = renderToStaticMarkup(
      createElement(TranscriptToolCallItemBlock, {
        item,
        workspaceId: "workspace-1",
        onOpenArtifact: () => {},
      }),
    );

    expect(html).toContain("Closed subagent");
    expect(html).toContain("API Surface Check");
    expect(html).not.toContain("Open API Surface Check");
  });

  it("opens non-closed subagent receipts by child session id", () => {
    const item = toolCallItem({
      semanticKind: "subagent",
      nativeToolName: "mcp__subagents__get_subagent_status",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        childSessionId: "child-123",
        label: "API Surface Check",
        status: "running",
      },
    });
    const onOpenSession = vi.fn();

    render(
      <TranscriptContextProviders
        sessionId="parent-session"
        onOpenSession={onOpenSession}
      >
        <TranscriptToolCallItemBlock
          item={item}
          workspaceId="workspace-1"
          onOpenArtifact={() => {}}
        />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*api surface check/i }));

    expect(onOpenSession).toHaveBeenCalledWith("child-123", "linked-child");
  });

  it("keeps closed subagent receipts non-openable in interactive render", () => {
    const item = toolCallItem({
      semanticKind: "subagent",
      nativeToolName: "mcp__subagents__close_subagent",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        childSessionId: "child-123",
        label: "API Surface Check",
        closed: true,
      },
    });

    render(
      <TranscriptContextProviders
        sessionId="parent-session"
        onOpenSession={() => {}}
      >
        <TranscriptToolCallItemBlock
          item={item}
          workspaceId="workspace-1"
          onOpenArtifact={() => {}}
        />
      </TranscriptContextProviders>,
    );

    expect(screen.queryByRole("button", { name: /open .*api surface check/i })).toBeNull();
  });

  it("expands subagent receipt result text on demand", () => {
    const item = toolCallItem({
      semanticKind: "subagent",
      nativeToolName: "mcp__subagents__search_subagent_transcript",
      rawOutput: {
        label: "API Surface Check",
        matches: [{ line: "needle" }],
      },
      contentParts: [{
        type: "tool_result_text",
        text: "{\"matches\":[{\"line\":\"needle\"}]}",
      }],
    });

    render(
      <TranscriptToolCallItemBlock
        item={item}
        workspaceId="workspace-1"
        onOpenArtifact={() => {}}
      />,
    );

    expect(screen.queryByText(/needle/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show subagent tool result/i }));

    expect(screen.getByText(/needle/)).toBeTruthy();
  });
});
