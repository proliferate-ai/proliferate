// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposedPlanCard } from "./ProposedPlanCard";

describe("ProposedPlanCard", () => {

  afterEach(() => {
    cleanup();
  });

  it("labels a pending native approval as awaiting approval with an Approve primary", () => {
    render(
      <ProposedPlanCard
        content="Do the work."
        isStreaming={false}
        decisionState="pending"
        nativeResolutionState="pending_link"
        decisionVersion={1}
        nativeContinuation
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeTruthy();
  });

  it("hides the carry-out action after native continuation succeeds", () => {
    render(
      <ProposedPlanCard
        content="Do the work."
        isStreaming={false}
        decisionState="approved"
        nativeResolutionState="finalized"
        decisionVersion={2}
        nativeContinuation
        onImplementHere={vi.fn()}
      />,
    );

    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /run here/i })).toBeNull();
  });

  it("offers a retry as the Approve primary when an approved native plan is still waiting", () => {
    render(
      <ProposedPlanCard
        content="Do the work."
        isStreaming={false}
        decisionState="approved"
        nativeResolutionState="pending_link"
        decisionVersion={2}
        nativeContinuation
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeTruthy();
  });

  it("keeps Run here as the primary fallback when native continuation fails", () => {
    render(
      <ProposedPlanCard
        content="Do the work."
        isStreaming={false}
        decisionState="approved"
        nativeResolutionState="failed"
        decisionVersion={2}
        nativeContinuation
        onImplementHere={vi.fn()}
      />,
    );

    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /run here/i })).toBeTruthy();
  });

  it("surfaces a failure message on its own destructive line, not inside the chip", () => {
    render(
      <ProposedPlanCard
        content="Do the work."
        isStreaming={false}
        decisionState="approved"
        nativeResolutionState="failed"
        decisionVersion={2}
        errorMessage="agent crashed mid-run"
        nativeContinuation
        onImplementHere={vi.fn()}
      />,
    );

    // The chip stays in the fixed vocabulary...
    expect(screen.getByText("Failed")).toBeTruthy();
    // ...and the raw message renders on a separate destructive line.
    const message = screen.getByText("agent crashed mid-run");
    expect(message.className).toContain("text-destructive");
  });

  it("renders no chip and no footer while the plan is still streaming", () => {
    render(
      <ProposedPlanCard
        content="Drafting..."
        isStreaming
        decisionState="streaming"
      />,
    );

    expect(screen.queryByText("Awaiting approval")).toBeNull();
    expect(screen.queryByText("Approved")).toBeNull();
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
  });

  it("tucks secondary actions behind an overflow menu instead of extra buttons", () => {
    render(
      <ProposedPlanCard
        content="Do the work."
        isStreaming={false}
        decisionState="pending"
        decisionVersion={1}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onHandOffToNewSession={vi.fn()}
      />,
    );

    // Approve + Reject are the only visible action buttons; "New session"
    // lives inside the closed overflow menu.
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /more plan actions/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new session/i })).toBeNull();
  });
});
