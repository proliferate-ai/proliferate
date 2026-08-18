/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundCompletionReceipt } from "./BackgroundCompletionReceipt";
import type {
  SubagentCompletionReceipt,
  TerminalCompletionReceipt,
} from "#product/domain/activity/background-completion-receipt";

afterEach(() => {
  cleanup();
});

function terminalReceipt(
  overrides: Partial<TerminalCompletionReceipt> = {},
): TerminalCompletionReceipt {
  return {
    kind: "terminal",
    key: "terminal:proc-1",
    processId: "proc-1",
    command: "pytest -q tests/e2e",
    exitCode: 0,
    atMs: 1_000,
    anchorTurnId: null,
    ...overrides,
  };
}

function subagentReceipt(
  overrides: Partial<SubagentCompletionReceipt> = {},
): SubagentCompletionReceipt {
  return {
    kind: "subagent",
    key: "subagent:task-1",
    subagentId: "task-1",
    title: "audit the roster",
    outcome: "completed",
    atMs: 1_000,
    anchorTurnId: null,
    ...overrides,
  };
}

describe("BackgroundCompletionReceipt — terminal", () => {
  it("renders the design markup: exited-code verb + mono command button on the incoming rail", () => {
    const { container } = render(
      <BackgroundCompletionReceipt receipt={terminalReceipt()} workspaceId="ws-1" onOpen={() => {}} />,
    );
    const rail = container.querySelector('[data-background-completion-receipt="terminal"]');
    expect(rail).toBeTruthy();
    const receipt = container.querySelector('[data-agent-message-receipt][data-direction="incoming"]');
    expect(receipt).toBeTruthy();
    expect(screen.getByText("exited 0 ·")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Open terminal pytest -q tests/e2e" });
    expect(button.className).toContain("font-mono");
    expect(button.textContent).toBe("pytest -q tests/e2e");
  });

  it("shows a nonzero exit code in the verb", () => {
    render(
      <BackgroundCompletionReceipt
        receipt={terminalReceipt({ exitCode: 130 })}
        workspaceId="ws-1"
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("exited 130 ·")).toBeTruthy();
  });

  it("fires onOpen when the command button is clicked (terminal deep-open)", () => {
    const onOpen = vi.fn();
    render(
      <BackgroundCompletionReceipt receipt={terminalReceipt()} workspaceId="ws-1" onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open terminal pytest -q tests/e2e" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("BackgroundCompletionReceipt — subagent", () => {
  it("renders 'finished ·' + an identity chip keyed by the wire agent id", () => {
    const { container } = render(
      <BackgroundCompletionReceipt receipt={subagentReceipt()} workspaceId="ws-1" onOpen={() => {}} />,
    );
    expect(container.querySelector('[data-background-completion-receipt="subagent"]')).toBeTruthy();
    expect(screen.getByText("finished ·")).toBeTruthy();
    expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
    expect(screen.getByText("audit the roster")).toBeTruthy();
  });

  it("renders 'failed ·' for a failed subagent", () => {
    render(
      <BackgroundCompletionReceipt
        receipt={subagentReceipt({ outcome: "failed" })}
        workspaceId="ws-1"
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("failed ·")).toBeTruthy();
  });

  it("fires onOpen when the identity chip is clicked (subagent deep-open)", () => {
    const onOpen = vi.fn();
    render(
      <BackgroundCompletionReceipt receipt={subagentReceipt()} workspaceId="ws-1" onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // Identity-less fallback: a receipt whose subagent id cannot mint a durable
  // identity (no session id) degrades to the plain title-fallback span, never a
  // broken chip button.
  it("falls back to a plain title span when no durable identity can be minted", () => {
    const { container } = render(
      <BackgroundCompletionReceipt
        receipt={subagentReceipt({ subagentId: "" })}
        workspaceId="ws-1"
        onOpen={() => {}}
      />,
    );
    expect(container.querySelector("[data-agent-identity-chip]")).toBeNull();
    expect(container.querySelector("[data-agent-message-fallback]")).toBeTruthy();
    expect(screen.getByText("audit the roster")).toBeTruthy();
  });
});
