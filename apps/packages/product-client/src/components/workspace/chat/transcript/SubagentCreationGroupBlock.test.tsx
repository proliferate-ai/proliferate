// @vitest-environment jsdom

import { Profiler } from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentCreationGroupBlock } from "#product/components/workspace/chat/transcript/SubagentCreationGroupBlock";
import {
  SpawnMotionFixture,
  transcriptWithCreates,
  workspaceCreateAgent,
} from "#product/components/workspace/chat/transcript/SubagentCreationGroupBlock.test-fixtures";
import { TranscriptContextProviders } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const mocks = vi.hoisted(() => ({
  openAgentsPaneTarget: vi.fn(() => false),
  openWorkspaceSession: vi.fn(),
  selectedWorkspaceId: "workspace-1" as string | null,
  projectedWorkspaceIds: new Set<string>(),
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-navigation-actions", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("#product/hooks/agents/workflows/use-agents-pane-navigation-actions")
  >();
  return {
    ...original,
    useAgentsPaneNavigationActions: () => ({
      classifyAgentsPaneTarget: () => "subagent" as const,
      openAgentsPaneTarget: mocks.openAgentsPaneTarget,
    }),
  };
});

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: unknown) => unknown) => selector({
    selectedWorkspaceId: mocks.selectedWorkspaceId,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      allWorkspaces: [...mocks.projectedWorkspaceIds].map((id) => ({ id })),
    },
  }),
}));

beforeEach(() => {
  mocks.openAgentsPaneTarget.mockReset().mockReturnValue(false);
  mocks.openWorkspaceSession.mockReset();
  mocks.selectedWorkspaceId = "workspace-1";
  mocks.projectedWorkspaceIds = new Set(["workspace-1"]);
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
});

afterEach(() => {
  cleanup();
});

describe("SubagentCreationGroupBlock", () => {
  it("adds durable identity chips progressively while preserving the run", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent("create-1", "session-child-1", "Schema audit"),
      "create-2": workspaceCreateAgent("create-2", null, "Test audit", "in_progress"),
    };

    const { container, rerender } = render(
      <SubagentCreationGroupBlock itemIds={["create-1", "create-2"]} transcript={transcript} />,
    );

    expect(container.querySelectorAll("[data-agent-identity-chip]")).toHaveLength(1);
    expect(screen.getByText("Schema audit")).toBeTruthy();
    expect(screen.getByText("started working")).toBeTruthy();

    transcript.itemsById["create-2"] = workspaceCreateAgent(
      "create-2",
      "session-child-2",
      "Test audit",
    );
    rerender(
      <SubagentCreationGroupBlock itemIds={["create-1", "create-2"]} transcript={transcript} />,
    );

    expect(container.querySelectorAll("[data-agent-identity-chip]")).toHaveLength(2);
    expect(screen.getByText("Schema audit")).toBeTruthy();
    expect(screen.getByText("Test audit")).toBeTruthy();
  });

  it("pops each newly settled live chip once without remounting earlier chips", () => {
    const empty = createTranscriptState("session-1");
    const rendered = render(
      <SpawnMotionFixture transcript={empty} itemIds={[]} />,
    );
    const first = transcriptWithCreates([
      workspaceCreateAgent("create-1", "session-child-1", "Schema audit"),
    ]);
    rendered.rerender(
      <SpawnMotionFixture transcript={first} itemIds={["create-1"]} />,
    );

    const firstEntry = rendered.container.querySelector(
      "[data-subagent-spawn-entry='create-1']",
    );
    expect(firstEntry?.getAttribute("data-subagent-spawn-entry-motion")).toBe("true");
    expect(firstEntry?.className).toContain("subagent-spawn-chip-enter");

    const second = transcriptWithCreates([
      workspaceCreateAgent("create-1", "session-child-1", "Schema audit"),
      workspaceCreateAgent("create-2", "session-child-2", "Test audit"),
    ]);
    rendered.rerender(
      <SpawnMotionFixture transcript={second} itemIds={["create-1", "create-2"]} />,
    );

    expect(rendered.container.querySelector("[data-subagent-spawn-entry='create-1']"))
      .toBe(firstEntry);
    expect(rendered.container.querySelector("[data-subagent-spawn-entry='create-2']")
      ?.getAttribute("data-subagent-spawn-entry-motion")).toBe("true");

    rendered.rerender(
      <SpawnMotionFixture transcript={second} itemIds={["create-1", "create-2"]} show={false} />,
    );
    rendered.rerender(
      <SpawnMotionFixture transcript={second} itemIds={["create-1", "create-2"]} />,
    );
    expect(rendered.container.querySelector("[data-subagent-spawn-entry-motion='true']"))
      .toBeNull();
  });

  it("keeps hydrated/replayed spawn chips static", () => {
    const transcript = transcriptWithCreates([
      workspaceCreateAgent("create-1", "session-child-1", "Schema audit"),
    ]);

    const { container } = render(
      <SpawnMotionFixture transcript={transcript} itemIds={["create-1"]} />,
    );

    expect(container.querySelector("[data-subagent-spawn-entry='create-1']")).toBeTruthy();
    expect(container.querySelector("[data-subagent-spawn-entry-motion='true']")).toBeNull();
  });

  it("uses the owned compositor-only pop recipe with a reduced-motion fallback", () => {
    const cssPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../../../packages/design/src/css/product.css",
    );
    const css = readFileSync(cssPath, "utf8");
    const start = css.indexOf("@keyframes subagent-spawn-chip-enter");
    const end = css.indexOf("Satellite ripple", start);
    const section = css.slice(start, end);

    expect(section).toContain("transform: scale(0.9)");
    expect(section).toContain("transform: scale(1)");
    expect(section).toContain(
      "animation: subagent-spawn-chip-enter var(--duration-pop) var(--ease-pop) both",
    );
    expect(section).toContain("@media (prefers-reduced-motion: reduce)");
    expect(section).toContain("animation: none");
    expect(section).not.toContain("translate(");
    expect(section).not.toContain("height:");
    expect(section).not.toContain("margin:");
  });

  it("does not mint a provisional glyph before durable session identity arrives", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent("create-1", null, "Schema audit", "in_progress"),
    };

    const { container } = render(
      <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("shows a failed spawn without inventing identity", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent("create-1", null, "Schema audit", "failed"),
    };

    const { container } = render(
      <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />,
    );

    expect(container.querySelector("[data-subagent-spawn-failed]")?.textContent)
      .toBe("Schema audit");
    expect(container.querySelector("[data-agent-identity-chip]")).toBeNull();
    expect(screen.getByText("failed to start")).toBeTruthy();
  });

  it("keeps an explicitly current non-subagent link on ordinary session navigation", () => {
    useSessionDirectoryStore.getState().recordRelationshipHint("session-child-1", {
      kind: "linked_child",
      parentSessionId: "session-1",
      relation: "handoff",
      workspaceId: "workspace-1",
    });
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent("create-1", "session-child-1", "Schema audit"),
    };
    const onOpenSession = vi.fn();

    render(
      <TranscriptContextProviders sessionId="session-1" onOpenSession={onOpenSession}>
        <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("session-child-1", "linked-child");
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it.each(["durable", "matching pending"] as const)(
    "owns a current-workspace spawn with %s authority even when the pane opener declines",
    (authority) => {
      if (authority === "durable") {
        useSessionDirectoryStore.getState().recordRelationshipHint("durable-child", {
          kind: "subagent_child",
          parentSessionId: "durable-parent",
          relation: "subagent",
          workspaceId: "workspace-1",
        });
      } else {
        putSessionRecord(createEmptySessionRecord("client-session:pending", "codex", {
          workspaceId: "workspace-1",
          materializedSessionId: "durable-child",
          title: "Schema audit",
        }));
      }
      const transcript = createTranscriptState("parent-session");
      transcript.itemsById = {
        "create-1": workspaceCreateAgent(
          "create-1",
          "durable-child",
          "Schema audit",
          "completed",
          "workspace-1",
          "durable-parent",
        ),
      };
      const onOpenSession = vi.fn();

      render(
        <TranscriptContextProviders sessionId="durable-parent" onOpenSession={onOpenSession}>
          <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
        </TranscriptContextProviders>,
      );

      fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));

      expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        parentSessionId: "durable-parent",
        childSessionId: "durable-child",
        historicalSubagentProvenance: true,
      });
      expect(onOpenSession).not.toHaveBeenCalled();
      expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
    },
  );

  it.each(["absent", "pending without workspace", "pending with mismatched workspace"] as const)(
    "keeps a historical spawn non-clickable while current authority is %s",
    (authority) => {
      if (authority !== "absent") {
        putSessionRecord(createEmptySessionRecord("client-session:pending", "codex", {
          workspaceId: authority === "pending without workspace" ? null : "workspace-other",
          materializedSessionId: "session-child-pending",
          title: "Pending audit",
        }));
      }
      const sessionId = authority === "absent"
        ? "session-child-absent"
        : "session-child-pending";
      const transcript = createTranscriptState("parent-session");
      transcript.itemsById = {
        "create-1": workspaceCreateAgent(
          "create-1",
          sessionId,
          "Pending audit",
          "completed",
          "workspace-1",
          "parent-session",
        ),
      };

      const { container } = render(
        <TranscriptContextProviders sessionId="parent-session" onOpenSession={vi.fn()}>
          <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
        </TranscriptContextProviders>,
      );

      expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /open .*pending audit/i })).toBeNull();
    },
  );

  it("withholds navigation when a create result disagrees with the transcript parent", () => {
    putSessionRecord(createEmptySessionRecord("client-session:pending", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: "durable-child",
      title: "Wrong parent audit",
    }));
    const transcript = createTranscriptState("parent-session");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent(
        "create-1", "durable-child", "Wrong parent audit", "completed",
        "workspace-1", "different-parent",
      ),
    };

    const { container } = render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={vi.fn()}>
        <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
      </TranscriptContextProviders>,
    );

    expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open .*wrong parent audit/i })).toBeNull();
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
  });

  it("opens a mapped spawned session through its ProductClient session key", () => {
    putSessionRecord(createEmptySessionRecord("client-session:child", "codex", {
      workspaceId: "workspace-other",
      materializedSessionId: "session-child-1",
      title: "Schema audit",
    }));
    useSessionDirectoryStore.getState().recordRelationshipHint("client-session:child", {
      kind: "subagent_child",
      parentSessionId: "session-1",
      relation: "subagent",
      workspaceId: "workspace-other",
    });
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent(
        "create-1",
        "session-child-1",
        "Schema audit",
        "completed",
        "workspace-other",
      ),
    };

    render(
      <TranscriptContextProviders sessionId="session-1" onOpenSession={vi.fn()}>
        <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(mocks.openWorkspaceSession).toHaveBeenCalledWith({
      workspaceId: "workspace-other",
      sessionId: "client-session:child",
    });
  });

  it("keeps a promoted current root on ordinary session navigation despite spawn history", () => {
    putSessionRecord(createEmptySessionRecord("client-session:promoted", "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: "session-child-1",
      title: "Schema audit",
      sessionRelationship: { kind: "root" },
    }));
    useSessionDirectoryStore.getState().markSessionPromoted(
      ["session-child-1", "client-session:promoted"],
      "workspace-1",
    );
    const transcript = createTranscriptState("parent-session");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent(
        "create-1",
        "session-child-1",
        "Schema audit",
        "completed",
        "workspace-1",
        "parent-session",
      ),
    };
    const onOpenSession = vi.fn();

    render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={onOpenSession}>
        <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("client-session:promoted", "generic");
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("opens an uncached cross-workspace spawn once that workspace is projected", () => {
    mocks.projectedWorkspaceIds.add("workspace-other");
    useSessionDirectoryStore.getState().recordRelationshipHint("session-child-1", {
      kind: "subagent_child",
      parentSessionId: "session-1",
      relation: "subagent",
      workspaceId: "workspace-other",
    });
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent(
        "create-1",
        "session-child-1",
        "Schema audit",
        "completed",
        "workspace-other",
      ),
    };

    render(
      <TranscriptContextProviders sessionId="session-1" onOpenSession={vi.fn()}>
        <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(mocks.openWorkspaceSession).toHaveBeenCalledWith({
      workspaceId: "workspace-other",
      sessionId: "session-child-1",
    });
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
  });

  it("keeps an unprojected cross-workspace spawn attributable but non-clickable", () => {
    useSessionDirectoryStore.getState().recordRelationshipHint("session-child-1", {
      kind: "subagent_child",
      parentSessionId: "session-1",
      relation: "subagent",
      workspaceId: "workspace-unprojected",
    });
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent(
        "create-1",
        "session-child-1",
        "Schema audit",
        "completed",
        "workspace-unprojected",
      ),
    };

    const { container } = render(
      <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />,
    );

    expect(container.querySelector("[data-agent-identity-chip] svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("uses raw task text when the production AgentView omits its optional title", () => {
    const create = workspaceCreateAgent(
      "create-titleless",
      "session-child-titleless",
      "Inspect the replay boundary",
    );
    const output = create.rawOutput as Record<string, unknown>;
    create.rawOutput = Object.fromEntries(
      Object.entries(output).filter(([key]) => key !== "title"),
    );
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { [create.itemId]: create };

    render(<SubagentCreationGroupBlock itemIds={[create.itemId]} transcript={transcript} />);

    expect(screen.getByText("Inspect the replay boundary")).toBeTruthy();
    expect(screen.queryByText("Agent")).toBeNull();
  });

  it("discloses distinguishable per-create results without remounting settled chips", () => {
    const success = workspaceCreateAgent(
      "create-success",
      "session-child-success",
      "Inspect replay",
    );
    const successOutput = success.rawOutput as Record<string, unknown>;
    success.rawOutput = Object.fromEntries(
      Object.entries(successOutput).filter(([key]) => key !== "title"),
    );
    const failed = workspaceCreateAgent(
      "create-failed",
      null,
      "Failure audit",
      "failed",
    );
    failed.contentParts = [
      ...failed.contentParts,
      { type: "tool_result_text", text: "provider rejected the requested agent configuration" },
    ];
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      [success.itemId]: success,
      [failed.itemId]: failed,
    };

    const { container } = render(
      <SubagentCreationGroupBlock
        itemIds={[success.itemId, failed.itemId]}
        transcript={transcript}
      />,
    );
    const settledChip = container.querySelector("[data-agent-identity-chip]");

    expect(screen.queryByText("provider rejected the requested agent configuration")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show agent creation details" }));

    expect(container.querySelectorAll("[data-subagent-creation-detail]")).toHaveLength(2);
    expect(screen.getAllByText("Inspect replay")).toHaveLength(2);
    expect(screen.getAllByText("Failure audit")).toHaveLength(2);
    expect(screen.getByText(/session-child-success/)).toBeTruthy();
    expect(screen.getByText("provider rejected the requested agent configuration")).toBeTruthy();
    expect(container.querySelector("[data-agent-identity-chip]")).toBe(settledChip);

    fireEvent.click(screen.getByRole("button", { name: "Hide agent creation details" }));
    expect(container.querySelector("[data-subagent-creation-details]")).toBeNull();
  });

  it("ignores unrelated directory activity but updates its own mapped navigation", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": workspaceCreateAgent("create-1", "session-child-1", "Schema audit"),
    };
    const onOpenSession = vi.fn();
    let renderCount = 0;

    render(
      <TranscriptContextProviders sessionId="session-1" onOpenSession={onOpenSession}>
        <Profiler id="spawn-group" onRender={() => { renderCount += 1; }}>
          <SubagentCreationGroupBlock itemIds={["create-1"]} transcript={transcript} />
        </Profiler>
      </TranscriptContextProviders>,
    );
    const initialRenderCount = renderCount;

    act(() => {
      putSessionRecord(createEmptySessionRecord("unrelated-session", "codex", {
        workspaceId: "workspace-1",
        title: "Unrelated activity",
      }));
    });
    expect(renderCount).toBe(initialRenderCount);

    act(() => {
      putSessionRecord(createEmptySessionRecord("client-session:child", "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: "session-child-1",
        title: "Schema audit",
        sessionRelationship: {
          kind: "linked_child",
          parentSessionId: "session-1",
          relation: "handoff",
          workspaceId: "workspace-1",
        },
      }));
    });
    expect(renderCount).toBeGreaterThan(initialRenderCount);

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("client-session:child", "linked-child");
  });
});
