// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTranscriptState, type PromptProvenance } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOriginPromptReceipt } from "#product/components/workspace/chat/transcript/AgentOriginPromptReceipt";
import { TranscriptContextProviders } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { delegatedWorkVisualIdentity } from "#product/lib/domain/delegated-work/identity";
import { solidSealGeometry } from "#product/lib/domain/delegated-work/solid-seal";

const mocks = vi.hoisted(() => ({
  openAgentsPaneTarget: vi.fn(() => false),
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-navigation-actions", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("#product/hooks/agents/workflows/use-agents-pane-navigation-actions")
  >();
  return {
    ...original,
    useAgentsPaneNavigationActions: () => ({
      openAgentsPaneTarget: mocks.openAgentsPaneTarget,
    }),
  };
});

beforeEach(() => {
  mocks.openAgentsPaneTarget.mockReset().mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  useSessionDirectoryStore.getState().clearEntries();
});

describe("AgentOriginPromptReceipt", () => {
  it.each([
    ["completed", "finished ·"],
    ["failed", "failed ·"],
    ["cancelled", "cancelled ·"],
  ] as const)("renders a resolved wake outcome %s on the right", (outcome, verb) => {
    const transcript = createTranscriptState("parent-session");
    transcript.linkCompletionsByCompletionId["completion-1"] = completion(outcome);

    const { container } = render(
      <AgentOriginPromptReceipt
        provenance={wakeProvenance()}
        exactMessage="Exact durable wake body"
        transcript={transcript}
        parentSessionId="parent-session"
        workspaceId="workspace-1"
      />,
    );

    expect(container.querySelector("[data-agent-origin-prompt]")?.className).toContain("justify-end");
    expect(container.querySelector("[data-agent-message-receipt]")?.getAttribute("data-direction"))
      .toBe("incoming");
    expect(container.textContent).toContain(verb);
    expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
  });

  it("does not infer wake identity or outcome from hidden prompt text", () => {
    const transcript = createTranscriptState("parent-session");
    const { container } = render(
      <AgentOriginPromptReceipt
        provenance={wakeProvenance()}
        exactMessage="Child session: invented-session-id. The child finished successfully."
        transcript={transcript}
        parentSessionId="parent-session"
        workspaceId="workspace-1"
      />,
    );

    expect(container.textContent).toContain("updated ·");
    expect(container.textContent).not.toContain("finished ·");
    expect(container.querySelector("[data-agent-identity-chip]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders direct agent-session replies with durable source identity", () => {
    const transcript = createTranscriptState("parent-session");
    const provenance: PromptProvenance = {
      type: "agentSession",
      sourceSessionId: "agent-session-2",
      label: "API audit",
    };
    const { container } = render(
      <AgentOriginPromptReceipt
        provenance={provenance}
        exactMessage="Here is the result"
        transcript={transcript}
        parentSessionId="parent-session"
        workspaceId="workspace-1"
      />,
    );

    expect(container.textContent).toContain("replied");
    expect(container.textContent).toContain("API audit");
    expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
  });

  it("opens a completion through its mapped client session with ingested authority", () => {
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-session:child",
      materializedSessionId: "agent-session-1",
      workspaceId: "workspace-child",
      agentKind: "codex",
      title: "Schema audit",
    });
    useSessionDirectoryStore.getState().recordRelationshipHint("client-session:child", {
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-child",
    });
    const transcript = createTranscriptState("parent-session");
    transcript.linkCompletionsByCompletionId["completion-1"] = completion("completed");
    const onOpenSession = vi.fn();
    const canOpenSession = vi.fn(() => true);

    render(
      <TranscriptContextProviders
        sessionId="parent-session"
        onOpenSession={onOpenSession}
        canOpenSession={canOpenSession}
      >
        <AgentOriginPromptReceipt
          provenance={wakeProvenance()}
          exactMessage="Exact durable wake body"
          transcript={transcript}
          parentSessionId="parent-session"
          workspaceId="workspace-parent"
        />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(canOpenSession).toHaveBeenCalledWith("client-session:child", "linked-child");
    expect(onOpenSession).toHaveBeenCalledWith("client-session:child", "linked-child");
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
    expect(useSessionDirectoryStore.getState().entriesById["client-session:child"]?.sessionRelationship)
      .toMatchObject({ kind: "subagent_child", sessionLinkId: "link-1" });
    expect(useSessionDirectoryStore.getState().entriesById)
      .not.toHaveProperty("agent-session-1");
    const expectedGeometry = solidSealGeometry(
      delegatedWorkVisualIdentity("agent-session-1").glyphSeedHash,
    );
    const notch = document.querySelector("[data-solid-seal-notch]");
    expect(notch?.getAttribute("cx")).toBe(String(expectedGeometry.notchX));
    expect(notch?.getAttribute("cy")).toBe(String(expectedGeometry.notchY));
  });

  it.each(["durable", "matching pending"] as const)(
    "owns a current-workspace completion with %s authority when the pane opener declines",
    (authority) => {
      if (authority === "durable") {
        useSessionDirectoryStore.getState().recordRelationshipHint("agent-session-1", {
          kind: "subagent_child",
          parentSessionId: "parent-session",
          sessionLinkId: "link-1",
          relation: "subagent",
          workspaceId: "workspace-1",
        });
      } else {
        useSessionDirectoryStore.getState().upsertEntry({
          sessionId: "client-session:pending",
          materializedSessionId: "agent-session-1",
          workspaceId: "workspace-1",
          agentKind: "codex",
          title: "Schema audit",
          sessionRelationship: { kind: "pending" },
        });
      }
      const transcript = createTranscriptState("parent-session");
      transcript.linkCompletionsByCompletionId["completion-1"] = completion("completed");
      const onOpenSession = vi.fn();

      render(
        <TranscriptContextProviders sessionId="parent-session" onOpenSession={onOpenSession}>
          <AgentOriginPromptReceipt
            provenance={wakeProvenance()}
            exactMessage="Exact durable wake body"
            transcript={transcript}
            parentSessionId="parent-session"
            workspaceId="workspace-1"
          />
        </TranscriptContextProviders>,
      );

      fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));

      expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        parentSessionId: "parent-session",
        childSessionId: "agent-session-1",
        historicalSubagentProvenance: true,
      });
      expect(onOpenSession).not.toHaveBeenCalled();
    },
  );

  it.each(["absent", "pending without workspace", "pending with mismatched workspace"] as const)(
    "keeps a historical subagent wake non-clickable while current authority is %s",
    (authority) => {
      if (authority !== "absent") {
        useSessionDirectoryStore.getState().upsertEntry({
          sessionId: "client-session:pending",
          materializedSessionId: "agent-session-1",
          workspaceId: authority === "pending without workspace" ? null : "workspace-other",
          agentKind: "codex",
          title: "Schema audit",
          sessionRelationship: { kind: "pending" },
        });
      }
      const transcript = createTranscriptState("parent-session");
      transcript.linkCompletionsByCompletionId["completion-1"] = completion("completed");

      const { container } = render(
        <TranscriptContextProviders sessionId="parent-session" onOpenSession={vi.fn()}>
          <AgentOriginPromptReceipt
            provenance={wakeProvenance()}
            exactMessage="Historical durable wake body"
            transcript={transcript}
            parentSessionId="parent-session"
            workspaceId="workspace-1"
          />
        </TranscriptContextProviders>,
      );

      expect(container.querySelector("[data-agent-identity-chip]")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /open .*schema audit/i })).toBeNull();
    },
  );

  it("keeps a promoted current root on ordinary session navigation despite wake history", () => {
    mocks.openAgentsPaneTarget.mockReturnValue(true);
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-session:promoted",
      materializedSessionId: "agent-session-1",
      workspaceId: "workspace-1",
      agentKind: "codex",
      title: "Schema audit",
      sessionRelationship: { kind: "root" },
    });
    useSessionDirectoryStore.getState().markSessionPromoted(
      ["agent-session-1", "client-session:promoted"],
      "workspace-1",
    );
    const transcript = createTranscriptState("parent-session");
    transcript.linkCompletionsByCompletionId["completion-1"] = completion("completed");
    const onOpenSession = vi.fn();

    render(
      <TranscriptContextProviders sessionId="parent-session" onOpenSession={onOpenSession}>
        <AgentOriginPromptReceipt
          provenance={wakeProvenance()}
          exactMessage="Historical durable wake body"
          transcript={transcript}
          parentSessionId="parent-session"
          workspaceId="workspace-1"
        />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("client-session:promoted", "generic");
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
    expect(useSessionDirectoryStore.getState()
      .entriesById["client-session:promoted"]?.sessionRelationship).toEqual({ kind: "root" });
  });

  it("treats linked_child relation=subagent as a durable Agents-pane target", () => {
    mocks.openAgentsPaneTarget.mockReturnValue(true);
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-parent",
      materializedSessionId: "durable-parent",
      workspaceId: "workspace-1",
      agentKind: "codex",
      title: "Parent",
      sessionRelationship: { kind: "root" },
    });
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-child",
      materializedSessionId: "durable-child",
      workspaceId: "workspace-1",
      agentKind: "codex",
      title: "Compatibility child",
      sessionRelationship: {
        kind: "linked_child",
        parentSessionId: "client-parent",
        relation: "subagent",
      },
    });
    const onOpenSession = vi.fn();

    render(
      <TranscriptContextProviders sessionId="durable-parent" onOpenSession={onOpenSession}>
        <AgentOriginPromptReceipt
          provenance={{
            type: "agentSession",
            sourceSessionId: "durable-child",
            label: "Compatibility child",
          }}
          exactMessage="Compatibility reply"
          transcript={createTranscriptState("durable-parent")}
          parentSessionId="durable-parent"
          workspaceId="workspace-1"
        />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*compatibility child/i }));
    expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: "durable-parent",
      childSessionId: "durable-child",
      historicalSubagentProvenance: false,
    });
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "root" } as const, "generic"],
    [{
      kind: "cowork_child",
      parentSessionId: "parent-session",
      relation: "cowork",
      workspaceId: "workspace-1",
    } as const, "cowork-coding-child"],
    [{
      kind: "review_child",
      parentSessionId: "parent-session",
      relation: "review",
      workspaceId: "workspace-1",
    } as const, "linked-child"],
    [{
      kind: "linked_child",
      parentSessionId: "parent-session",
      relation: "handoff",
      workspaceId: "workspace-1",
    } as const, "linked-child"],
  ] as const)("keeps current-workspace non-subagent relation %# on session fallback", (
    sessionRelationship,
    role,
  ) => {
    mocks.openAgentsPaneTarget.mockReturnValue(true);
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-session:fallback",
      materializedSessionId: "agent-session-1",
      workspaceId: "workspace-1",
      agentKind: "codex",
      title: "Schema audit",
      sessionRelationship,
    });
    const onOpenSession = vi.fn();
    const canOpenSession = vi.fn(() => true);

    render(
      <TranscriptContextProviders
        sessionId="parent-session"
        onOpenSession={onOpenSession}
        canOpenSession={canOpenSession}
      >
        <AgentOriginPromptReceipt
          provenance={wakeProvenance()}
          exactMessage="Fallback reply"
          transcript={transcriptWithCompletion()}
          parentSessionId="parent-session"
          workspaceId="workspace-1"
        />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*schema audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("client-session:fallback", role);
    expect(mocks.openAgentsPaneTarget).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "root" } as const, "generic"],
    [{
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-child",
      relation: "subagent",
      workspaceId: "workspace-child",
    } as const, "linked-child"],
  ] as const)("opens a resolved agent reply with its directory role %#", (sessionRelationship, role) => {
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-session:reply",
      materializedSessionId: "durable-reply-session",
      workspaceId: "workspace-child",
      agentKind: "codex",
      title: "Reply source",
      sessionRelationship,
    });
    const provenance: PromptProvenance = {
      type: "agentSession",
      sourceSessionId: "durable-reply-session",
      label: "Reply source",
    };
    const onOpenSession = vi.fn();
    const canOpenSession = vi.fn(() => true);

    render(
      <TranscriptContextProviders
        sessionId="parent-session"
        onOpenSession={onOpenSession}
        canOpenSession={canOpenSession}
      >
        <AgentOriginPromptReceipt
          provenance={provenance}
          exactMessage="Here is the result"
          transcript={createTranscriptState("parent-session")}
          parentSessionId="parent-session"
          workspaceId="workspace-parent"
        />
      </TranscriptContextProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open .*reply source/i }));
    expect(canOpenSession).toHaveBeenCalledWith("client-session:reply", role);
    expect(onOpenSession).toHaveBeenCalledWith("client-session:reply", role);
  });
});

function wakeProvenance(): PromptProvenance {
  return {
    type: "subagentWake",
    sessionLinkId: "link-1",
    completionId: "completion-1",
    label: "Schema audit",
  };
}

function transcriptWithCompletion() {
  const transcript = createTranscriptState("parent-session");
  transcript.linkCompletionsByCompletionId["completion-1"] = completion("completed");
  return transcript;
}

function completion(outcome: "completed" | "failed" | "cancelled") {
  return {
    relation: "subagent",
    completionId: "completion-1",
    sessionLinkId: "link-1",
    parentSessionId: "parent-session",
    childSessionId: "agent-session-1",
    childTurnId: "turn-1",
    childLastEventSeq: 7,
    outcome,
    label: "Schema audit",
    seq: 8,
    timestamp: "2026-08-10T00:00:00Z",
  };
}
