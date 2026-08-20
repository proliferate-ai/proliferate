// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoworkCodingLedger,
  shouldShowCoworkCodingLedger,
} from "#product/components/workspace/chat/tool-calls/cowork/CoworkCodingToolLedger";

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

describe("shouldShowCoworkCodingLedger", () => {
  it("shows for the coding actions, not for unrelated ones", () => {
    expect(shouldShowCoworkCodingLedger("create_workspace")).toBe(true);
    expect(shouldShowCoworkCodingLedger("create_session")).toBe(true);
    expect(shouldShowCoworkCodingLedger("send_message")).toBe(true);
    expect(shouldShowCoworkCodingLedger("schedule_wake")).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(shouldShowCoworkCodingLedger("other" as any)).toBe(false);
  });
});

describe("CoworkCodingLedger prompt disclosure (user-authored)", () => {
  it("wires renderLink only into the prompt Markdown; user backticks stay inert", () => {
    render(
      <CoworkCodingLedger
        action="send_message"
        prompt="See [config](/repo/config.json) and `src/index.ts`."
        promptStatus="running"
        canOpenCodingSession
        canOpenWorkspace={false}
        failed={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Sent coding message/ }));

    expect(renderTranscriptLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/repo/config.json" }),
    );
    // No renderInlineCode is wired for this user-authored surface: the
    // shared MarkdownBody default handling renders the backtick literally
    // instead of ever reaching our transcript renderer.
    expect(renderTranscriptInlineCodeMock).not.toHaveBeenCalled();
    expect(screen.getByText("src/index.ts", { exact: false })).toBeTruthy();
  });
});
