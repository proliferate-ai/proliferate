// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceSessionRecoveryCard,
} from "#product/components/workspace/chat/surface/WorkspaceSessionRecoveryCard";

describe("WorkspaceSessionRecoveryCard", () => {
  afterEach(cleanup);

  it("offers one explicit retry, reload, and workspace exit path", () => {
    const onRetry = vi.fn();
    const onReload = vi.fn();
    const onBackToWorkspaces = vi.fn();
    render(
      <WorkspaceSessionRecoveryCard
        bottomInsetPx={0}
        isRetrying={false}
        reason="session-list-failed"
        onRetry={onRetry}
        onReload={onReload}
        onBackToWorkspaces={onBackToWorkspaces}
      />,
    );

    expect(screen.getByRole("alert", { name: "We couldn't open a session" })).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(document.activeElement).toBe(retryButton);
    fireEvent.click(retryButton);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to workspaces" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledOnce();
    expect(onBackToWorkspaces).toHaveBeenCalledOnce();
  });

  it("restores announcement and primary-action focus after recovery remounts", () => {
    const props = {
      bottomInsetPx: 0,
      isRetrying: false,
      reason: "session-list-failed" as const,
      onRetry: vi.fn(),
      onReload: vi.fn(),
      onBackToWorkspaces: vi.fn(),
    };
    const first = render(<WorkspaceSessionRecoveryCard {...props} />);
    const firstRetryButton = screen.getByRole("button", { name: "Retry" });
    expect(document.activeElement).toBe(firstRetryButton);

    first.unmount();
    render(<WorkspaceSessionRecoveryCard {...props} />);

    expect(screen.getByRole("alert", { name: "We couldn't open a session" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" }));
  });
});
