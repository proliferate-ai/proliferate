// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceSessionRecoveryInlinePanelView,
} from "#product/components/workspace/chat/surface/WorkspaceSessionRecoveryInlinePanel";

describe("WorkspaceSessionRecoveryInlinePanelView", () => {
  afterEach(cleanup);

  it("announces the inline failure, focuses Retry, and keeps one recovery action", () => {
    const onRetry = vi.fn();
    render(
      <WorkspaceSessionRecoveryInlinePanelView
        isRetrying={false}
        reason="session-create-failed"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert", { name: "Chat unavailable" })).toBeTruthy();
    expect(screen.queryByText("We couldn't open a session")).toBeNull();
    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(document.activeElement).toBe(retryButton);
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("restores announcement and Retry focus after a failed attempt remounts", () => {
    const props = {
      isRetrying: false,
      reason: "session-list-failed" as const,
      onRetry: vi.fn(),
    };
    const first = render(<WorkspaceSessionRecoveryInlinePanelView {...props} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" }));

    first.unmount();
    render(<WorkspaceSessionRecoveryInlinePanelView {...props} />);

    expect(screen.getByRole("alert", { name: "Chat unavailable" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" }));
  });

  it("explains missing configuration and exposes settings without losing Retry focus", () => {
    const onConfigure = vi.fn();
    render(
      <WorkspaceSessionRecoveryInlinePanelView
        isRetrying={false}
        reason="launch-configuration-unavailable"
        onConfigure={onConfigure}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/No agent and model are configured/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
    expect(onConfigure).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" }));
  });
});
