// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsToolResultRow } from "#product/components/workspace/chat/tool-calls/SkillsToolResultRow";
import type { SkillsToolResultPresentation } from "#product/domain/chats/tools/skills-tool-result";

const renderTranscriptLinkMock = vi.fn(() => null);
const renderTranscriptInlineCodeMock = vi.fn(() => null);

vi.mock("#product/components/workspace/chat/transcript/transcript-markdown", () => ({
  renderTranscriptLink: (...args: unknown[]) => renderTranscriptLinkMock(...args),
  renderTranscriptInlineCode: (...args: unknown[]) => renderTranscriptInlineCodeMock(...args),
}));

afterEach(() => {
  cleanup();
  renderTranscriptLinkMock.mockClear();
  renderTranscriptInlineCodeMock.mockClear();
});

function activatePresentation(instructions: string): SkillsToolResultPresentation {
  return {
    kind: "activate",
    skillId: "repo-explorer",
    displayName: "Repo Explorer",
    description: "Explores the repository.",
    instructions,
    requiredMcpServers: [],
    credentialBindingIds: [],
    resources: [],
  };
}

function resourcePresentation(content: string): SkillsToolResultPresentation {
  return {
    kind: "resource",
    skillId: "repo-explorer",
    resourceId: "readme",
    displayName: "README",
    contentType: "text/markdown",
    content,
  };
}

describe("SkillsToolResultRow", () => {
  it("labels and hints a skill-activation row", () => {
    render(
      <SkillsToolResultRow presentation={activatePresentation("Read `src/index.ts`.")} status="completed" />,
    );
    expect(screen.getByText("Skill activated")).toBeTruthy();
  });

  it("wires both link and inline-code transcript renderers into the instructions body (assistant-authored)", () => {
    render(
      <SkillsToolResultRow
        presentation={activatePresentation("See [config](/repo/config.json) and `src/index.ts`.")}
        status="completed"
      />,
    );
    fireEvent.click(screen.getByText("Skill activated"));

    expect(renderTranscriptLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/repo/config.json" }),
    );
    expect(renderTranscriptInlineCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "src/index.ts" }),
    );
  });

  it("wires both link and inline-code transcript renderers into the resource body (assistant-authored)", () => {
    render(
      <SkillsToolResultRow
        presentation={resourcePresentation("See [config](/repo/config.json) and `src/index.ts`.")}
        status="completed"
      />,
    );
    fireEvent.click(screen.getByText("Skill resource loaded"));

    expect(renderTranscriptLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/repo/config.json" }),
    );
    expect(renderTranscriptInlineCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "src/index.ts" }),
    );
  });
});
