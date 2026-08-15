// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMessageReceipt } from "#product/components/workspace/chat/transcript/AgentMessageReceipt";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { AGENT_MESSAGE_PREVIEW_MAX_CHARS } from "#product/lib/domain/delegated-work/presentation";

const IDENTITY = buildDelegatedAgentIdentity({
  id: "agent-session-1",
  sessionId: "agent-session-1",
  title: "Schema audit",
});

afterEach(cleanup);

describe("AgentMessageReceipt", () => {
  it("uses chip-then-verb for outgoing and verb-then-chip for incoming receipts", () => {
    const { container, rerender } = render(
      <AgentMessageReceipt direction="outgoing" identity={IDENTITY} verb="messaged" />,
    );

    expect(container.querySelector("[data-agent-message-receipt]")?.textContent)
      .toBe("Schema auditmessaged");
    expect(container.querySelector("[data-agent-message-receipt]")?.getAttribute("data-direction"))
      .toBe("outgoing");
    expect(container.querySelector("[data-agent-identity-chip] svg")?.getAttribute("width"))
      .toBe("16");
    expect(container.querySelector("[data-agent-identity-chip] svg")?.getAttribute("height"))
      .toBe("16");

    rerender(<AgentMessageReceipt direction="incoming" identity={IDENTITY} verb="replied" />);
    expect(container.querySelector("[data-agent-message-receipt]")?.textContent)
      .toBe("repliedSchema audit");
    expect(container.querySelector("[data-agent-message-receipt]")?.getAttribute("data-direction"))
      .toBe("incoming");
  });

  it("discloses an exact long message on keyboard focus without truncating its content", async () => {
    const exactMessage = "Keep  the double spaces and this deliberately long line\nplus its second line exactly.";
    render(
      <AgentMessageReceipt
        direction="outgoing"
        identity={IDENTITY}
        verb="messaged"
        exactMessage={exactMessage}
      />,
    );

    fireEvent.focus(document.querySelector("[data-agent-identity-chip]")!);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent)
        .toBe(exactMessage.replace("\n", ""));
    });
  });

  it("keeps unresolved receipts glyph-free while retaining focus disclosure", async () => {
    const exactMessage = "Hidden wake payload with child-session-looking-text";
    const { container } = render(
      <AgentMessageReceipt
        direction="incoming"
        identity={null}
        fallbackLabel="Agent"
        verb="updated ·"
        exactMessage={exactMessage}
      />,
    );

    expect(container.querySelector("[data-agent-identity-chip]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    fireEvent.focus(screen.getByLabelText("Agent message"));
    await waitFor(() => {
      expect(screen.getAllByText(exactMessage).length).toBeGreaterThan(0);
    });
  });

  it("clamps a very long message to a bounded tooltip preview", async () => {
    const exactMessage = `subagent brief ${"x".repeat(3000)}`;
    render(
      <AgentMessageReceipt
        direction="outgoing"
        identity={IDENTITY}
        verb="messaged"
        exactMessage={exactMessage}
      />,
    );

    fireEvent.focus(document.querySelector("[data-agent-identity-chip]")!);
    await waitFor(() => {
      const tooltip = screen.getByRole("tooltip");
      const preview = tooltip.textContent ?? "";
      expect(preview.length).toBeLessThanOrEqual(AGENT_MESSAGE_PREVIEW_MAX_CHARS);
      expect(preview.endsWith("…")).toBe(true);
      // The primitive itself must bound height so no caller can fill the
      // viewport with an unclamped payload.
      expect(tooltip.style.maxHeight).toBe("min(18rem, calc(100vh - 1.5rem))");
    });
  });

  it("clamps the fallback tooltip preview when no identity resolves", async () => {
    const exactMessage = `wake payload ${"y".repeat(3000)}`;
    render(
      <AgentMessageReceipt
        direction="incoming"
        identity={null}
        fallbackLabel="Agent"
        verb="updated ·"
        exactMessage={exactMessage}
      />,
    );

    fireEvent.focus(screen.getByLabelText("Agent message"));
    await waitFor(() => {
      const preview = screen.getByRole("tooltip").textContent ?? "";
      expect(preview.length).toBeLessThanOrEqual(AGENT_MESSAGE_PREVIEW_MAX_CHARS);
      expect(preview.endsWith("…")).toBe(true);
    });
  });

  it.each([
    ["with exact-message disclosure", "Exact message remains available"],
    ["without exact-message disclosure", null],
  ] as const)("bounds an unresolved long agent label %s", (_case, exactMessage) => {
    const fallbackLabel = `Agent-${"x".repeat(240)}`;
    const { container } = render(
      <AgentMessageReceipt
        direction="incoming"
        identity={null}
        fallbackLabel={fallbackLabel}
        verb="updated ·"
        exactMessage={exactMessage}
      />,
    );

    const fallback = container.querySelector("[data-agent-message-fallback]");
    expect(fallback?.textContent).toBe(fallbackLabel);
    expect(fallback?.className).toContain("min-w-0");
    expect(fallback?.className).toContain("max-w-72");
    expect(fallback?.className).toContain("shrink");
    expect(fallback?.className).toContain("truncate");
  });
});
