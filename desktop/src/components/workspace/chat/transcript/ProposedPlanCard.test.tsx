// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposedPlanCard } from "./ProposedPlanCard";

describe("ProposedPlanCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("presents native plan approval as continuing the current agent", () => {
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

    expect(screen.getByText("awaiting approval")).toBeTruthy();
    expect(screen.getByRole("button", { name: /approve and continue/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve plan/i })).toBeNull();
  });

  it("hides the prompt-based carry-out action after native continuation succeeds", () => {
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

    expect(screen.queryByRole("button", { name: /carry out/i })).toBeNull();
  });

  it("offers a retry when an approved native plan is still waiting to continue", () => {
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

    expect(screen.getByText("waiting to continue")).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue agent/i })).toBeTruthy();
  });

  it("keeps carry-out available as a fallback when native continuation fails", () => {
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

    expect(screen.getByRole("button", { name: /carry out here instead/i })).toBeTruthy();
  });
});
