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

    expect(screen.getByText("We couldn't open a session")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to workspaces" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledOnce();
    expect(onBackToWorkspaces).toHaveBeenCalledOnce();
  });
});
