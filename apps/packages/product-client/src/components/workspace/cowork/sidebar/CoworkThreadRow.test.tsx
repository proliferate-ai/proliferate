/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { CoworkThread } from "@anyharness/sdk";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoworkThreadRow } from "#product/components/workspace/cowork/sidebar/CoworkThreadRow";

vi.mock("@proliferate/ui/icons", () => ({
  ChevronDown: () => <span />,
  ChevronRight: () => <span />,
}));

vi.mock("@proliferate/ui/primitives/IconButton", () => ({
  IconButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock("#product/components/workspace/shell/sidebar/SidebarIndicators", () => ({
  SidebarStatusIndicatorView: () => <span data-testid="activity-indicator" />,
}));

vi.mock("@proliferate/product-ui/sidebar/ProductSidebarThreads", () => ({
  ProductSidebarThreadRow: ({
    status,
    trailingStatus,
  }: {
    status?: ReactNode;
    trailingStatus?: ReactNode;
  }) => (
    <div>
      <div data-testid="leading-status">{status}</div>
      <div data-testid="trailing-status">{trailingStatus}</div>
    </div>
  ),
}));

afterEach(cleanup);

describe("CoworkThreadRow", () => {
  it("puts iterating activity in the workspace-convention trailing slot", () => {
    render(
      <CoworkThreadRow
        thread={thread()}
        active
        activity="iterating"
        canExpand={false}
        expanded={false}
        onToggleExpanded={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("leading-status").children).toHaveLength(0);
    expect(screen.getByTestId("trailing-status").querySelector("[data-testid='activity-indicator']"))
      .not.toBeNull();
  });
});

function thread(): CoworkThread {
  return {
    id: "thread-1",
    workspaceId: "workspace-cowork",
    sessionId: "session-cowork",
    repoRootId: "repo-root-1",
    branchName: "cowork/thread-1",
    agentKind: "codex",
    title: null,
    createdAt: "2026-07-15T12:00:00Z",
    updatedAt: "2026-07-15T12:00:00Z",
    workspaceDelegationEnabled: false,
  };
}
