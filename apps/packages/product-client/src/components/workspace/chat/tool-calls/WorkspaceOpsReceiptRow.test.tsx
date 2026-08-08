// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceOpsReceiptRow } from "#product/components/workspace/chat/tool-calls/WorkspaceOpsReceiptRow";
import { TranscriptContextProviders } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { deriveWorkspaceOpsReceipt } from "#product/domain/chats/subagents/workspace-ops-presentation";
import { toolItem } from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";

function spawnWorkspaceItem(output: Record<string, unknown>, status: "completed" | "failed" = "completed") {
  const item = toolItem("spawn-ws", "turn-1", 1, "other", status);
  item.nativeToolName = "mcp__subagents__spawn_workspace";
  item.rawInput = {};
  item.rawOutput = output;
  return item;
}

describe("workspace creation receipts", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads as one line: verb, name, provenance, Open", () => {
    const presentation = deriveWorkspaceOpsReceipt(spawnWorkspaceItem({
      workspaceId: "ws-1",
      workspaceName: "billing-hotfix-dispatch",
      repoName: "proliferate",
      mode: "worktree",
      baseBranch: "main",
    }));
    expect(presentation).not.toBeNull();

    const { container } = render(
      <TranscriptContextProviders sessionId="s1" onOpenWorkspace={() => {}}>
        <WorkspaceOpsReceiptRow presentation={presentation!} />
      </TranscriptContextProviders>,
    );
    const row = container.querySelector("[data-workspace-ops-receipt]");

    expect(row?.textContent)
      .toBe("Created workspacebilling-hotfix-dispatch — proliferate · worktree from main·Open");
    // Quiet line, not a card: no artifact treatment anywhere on it.
    expect(row?.className).toContain("text-chat");
    expect(row?.querySelector(".rounded-xl")).toBeNull();
  });

  it("names its own failure instead of claiming a workspace", () => {
    const presentation = deriveWorkspaceOpsReceipt(
      spawnWorkspaceItem({ workspaceName: "billing-hotfix-dispatch" }, "failed"),
    );

    const { container } = render(<WorkspaceOpsReceiptRow presentation={presentation!} />);

    expect(container.textContent).toContain("Could not create workspace");
    // Nothing to open: the workspace does not exist.
    expect(container.querySelector("button")).toBeNull();
  });

  it("carries a run script the agent configured", () => {
    const presentation = deriveWorkspaceOpsReceipt(spawnWorkspaceItem({
      workspaceId: "ws-1",
      workspaceName: "billing-hotfix-dispatch",
      repoName: "proliferate",
      mode: "worktree",
      baseBranch: "main",
      runScript: "pnpm i && pnpm test:webhooks",
    }));

    const { container } = render(<WorkspaceOpsReceiptRow presentation={presentation!} />);

    expect(container.textContent).toContain("run script → pnpm i && pnpm test:webhooks");
  });

  it("is not derived for tool calls that make no workspace", () => {
    const item = toolItem("other", "turn-1", 1, "subagent");
    item.nativeToolName = "mcp__subagents__spawn_agent";

    expect(deriveWorkspaceOpsReceipt(item)).toBeNull();
  });
});
