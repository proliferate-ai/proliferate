// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranscriptState } from "@anyharness/sdk";
import type { ToolCallItem } from "@anyharness/sdk";
import { toolItem } from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import { TranscriptAgentGroupBlock } from "#product/components/workspace/chat/transcript/TranscriptAgentGroupBlock";
import { PromptContentRenderer } from "#product/components/workspace/chat/content/PromptContentRenderer";

// This file pins the authorship matrix — which transcript-owned surfaces
// wire which of transcript-markdown's two renderers, per 03C r2's
// authorized scope. Assistant/skill-authored surfaces (`SkillsToolResultRow`,
// `TranscriptAgentGroupBlock` delegated result) wire both `renderLink` and
// `renderInlineCode`; user-authored surfaces (`CoworkCodingToolLedger`
// prompt, `BackgroundSubagentView` initial prompt) wire `renderLink` only,
// so user backticked text stays inert per the standing product rule the
// r1 body itself defers. `SkillsToolResultRow.test.tsx` and
// `cowork/CoworkCodingToolLedger.test.tsx` cover those two surfaces
// directly; this file covers the remaining owner (`TranscriptAgentGroupBlock`)
// plus the shared `PromptContentRenderer` precedent the matrix is modeled
// on, and pins the renderers' own external-web-first classification.

afterEach(cleanup);

describe("renderTranscriptLink (real implementation, unmocked)", () => {
  it("does not convert an ordinary external web link (external-web-first)", async () => {
    const { renderTranscriptLink } = await vi.importActual<
      typeof import("#product/components/workspace/chat/transcript/transcript-markdown")
    >("#product/components/workspace/chat/transcript/transcript-markdown");

    expect(renderTranscriptLink({ href: "https://example.com/docs", children: "docs" })).toBeNull();
    const fileResult = renderTranscriptLink({ href: "/repo/src/index.ts", children: "index.ts" });
    expect(fileResult).not.toBeNull();
  });
});

const renderTranscriptLinkMock = vi.fn(() => null);
const renderTranscriptInlineCodeMock = vi.fn(() => null);

vi.mock("#product/components/workspace/chat/transcript/transcript-markdown", () => ({
  renderTranscriptLink: (...args: unknown[]) => renderTranscriptLinkMock(...args),
  renderTranscriptInlineCode: (...args: unknown[]) => renderTranscriptInlineCodeMock(...args),
  renderTranscriptCodeBlock: () => null,
}));

vi.mock("#product/hooks/access/anyharness/sessions/use-prompt-attachment-url", () => ({
  usePromptAttachmentUrl: () => ({ data: null, blob: null, isLoading: false, isError: false }),
}));
vi.mock("#product/components/workspace/chat/content/PlanReferenceAttachmentCard", () => ({
  PlanReferenceAttachmentCard: () => null,
}));

describe("authorship matrix: TranscriptAgentGroupBlock delegated result (assistant-authored)", () => {
  afterEach(() => {
    renderTranscriptLinkMock.mockClear();
    renderTranscriptInlineCodeMock.mockClear();
  });

  it("wires both renderLink and renderInlineCode into the delegated-agent result Markdown", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("native-task", "turn-1", 1, "subagent", "completed"),
      title: "Inspect the repository",
      nativeToolName: "Task",
      rawInput: { prompt: "Inspect the transcript pipeline" },
      rawOutput: { summary: "See [config](/repo/config.json) and `src/index.ts`." },
    };
    transcript.itemsById[item.itemId] = item;

    render(
      createElement(TranscriptAgentGroupBlock, {
        item,
        childIds: [],
        transcript,
        childrenByParentId: new Map(),
        renderChild: () => null,
      }),
    );

    fireEvent.click(screen.getByText("Inspect the repository"));

    expect(renderTranscriptLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/repo/config.json" }),
    );
    expect(renderTranscriptInlineCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "src/index.ts" }),
    );
  });
});

describe("authorship matrix: PromptContentRenderer (user-authored precedent)", () => {
  afterEach(() => {
    renderTranscriptLinkMock.mockClear();
    renderTranscriptInlineCodeMock.mockClear();
  });

  it("wires renderLink only; user backticks stay inert (the precedent CoworkCodingToolLedger/BackgroundSubagentView follow)", () => {
    render(
      createElement(PromptContentRenderer, {
        sessionId: null,
        parts: [{ type: "text", text: "See [config](/repo/config.json) and `src/index.ts`." }],
      }),
    );

    expect(renderTranscriptLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/repo/config.json" }),
    );
    expect(renderTranscriptInlineCodeMock).not.toHaveBeenCalled();
  });
});
