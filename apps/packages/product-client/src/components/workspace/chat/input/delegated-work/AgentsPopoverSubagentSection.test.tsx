// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsPopoverSubagentSection } from "#product/components/workspace/chat/input/delegated-work/AgentsPopoverSubagentSection";
import type { DelegatedWorkComposerViewModel } from "#product/hooks/chat/facade/use-delegated-work-composer";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

type Subagents = NonNullable<DelegatedWorkComposerViewModel["subagents"]>;

afterEach(cleanup);

describe("AgentsPopoverSubagentSection", () => {
  it("opens the parent cluster from both existing parent surfaces and exact detail from a child", () => {
    const openCluster = vi.fn();
    const openParent = vi.fn();
    const openSubagent = vi.fn();
    const onClose = vi.fn();
    const subagents: Subagents = {
      rows: [{
        sessionLinkId: "link-child-1",
        childSessionId: "child-1",
        label: "Schema audit",
        identity: buildDelegatedAgentIdentity({
          id: "link-child-1",
          sessionId: "child-1",
          sessionLinkId: "link-child-1",
          title: "Schema audit",
        }),
        statusLabel: "Available",
        statusCategory: "finished",
        latestCompletionLabel: null,
        wakeScheduled: false,
      }],
      parent: {
        parentSessionId: "parent-1",
        label: "Parent agent",
      },
      summary: {
        label: "Parent agent",
        detail: "Parent agent",
        active: false,
      },
      overflowCount: 0,
      openCluster,
      openParent,
      openSubagent,
    };

    render(
      <AgentsPopoverSubagentSection
        subagents={subagents}
        detail="1 subagent"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open subagents in Agents" }));
    expect(openCluster).toHaveBeenCalledTimes(1);
    expect(openParent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    const rowButtons = screen.getAllByRole("button");
    expect(rowButtons).toHaveLength(3);
    fireEvent.click(rowButtons[1]!);
    expect(openParent).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(rowButtons[2]!);
    expect(openSubagent).toHaveBeenCalledWith("child-1");
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
