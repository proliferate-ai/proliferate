// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { SubagentRosterEntry } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPaneDetail } from "#product/components/workspace/delegated-work/agents-pane/AgentsPaneDetail";

const mocks = vi.hoisted(() => ({
  lifecycleInput: vi.fn(),
  glyphProps: vi.fn(),
  messageListProps: vi.fn(),
  messageListRows: 0,
  sendPrompt: vi.fn(),
  closeChild: vi.fn(),
  openChild: vi.fn(),
  promoteChild: vi.fn(),
  openTranscriptSession: vi.fn(),
  canOpenTranscriptSession: vi.fn(() => true),
  lifecycle: {
    historyPhase: "ready" as "loading" | "ready" | "error",
    streamConnectionState: "open" as "connecting" | "open" | "disconnected" | "ended" | null,
    streamRequestPending: false,
    sessionViewState: "idle",
    retryHistory: vi.fn(),
    reconnect: vi.fn(),
  },
  pane: {
    transcript: { sessionId: "client-a" } as object | null,
    optimisticPrompt: null,
    outboxEntries: [],
    sessionViewState: "working",
    goalEvents: [],
  },
  pending: {
    close: false,
    open: false,
    promote: false,
  },
}));

vi.mock("#product/primitives/icons/core", () => ({
  ArrowLeft: () => <span data-icon="back" />,
  ArrowUp: () => <span data-icon="send" />,
}));

vi.mock("#product/primitives/Button", () => ({
  Button: ({
    children,
    loading,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    loading?: boolean;
    size?: string;
    variant?: string;
  }) => (
    <button data-loading={loading ? "true" : "false"} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("#product/primitives/patterns/ConfirmationDialog", () => ({
  ConfirmationDialog: ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    confirmVariant,
    loading,
    onClose,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    confirmVariant: string;
    loading: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }) => open ? (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <p>{description}</p>
      <button type="button" onClick={onClose}>{cancelLabel}</button>
      <button
        type="button"
        data-variant={confirmVariant}
        disabled={loading}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  ) : null,
}));

vi.mock("#product/components/workspace/delegated-work/AgentIdentityGlyph", () => ({
  AgentIdentityGlyph: (props: { dimension: number; label: string; closed: boolean }) => {
    mocks.glyphProps(props);
    return <span data-testid="agent-glyph" data-dimension={props.dimension} />;
  },
}));

vi.mock("#product/components/workspace/chat/transcript/MessageList", () => ({
  MessageList: (props: { activeSessionId: string; sessionViewState: string }) => {
    mocks.messageListProps(props);
    return (
      <div data-testid="message-list">
        {Array.from({ length: mocks.messageListRows }, (_, index) => (
          <div key={index}>Transcript row {index + 1}</div>
        ))}
      </div>
    );
  },
}));

vi.mock("#product/hooks/chat/workflows/use-transcript-session-navigation-actions", () => ({
  useTranscriptSessionNavigationActions: () => ({
    openTranscriptSession: mocks.openTranscriptSession,
    canOpenTranscriptSession: mocks.canOpenTranscriptSession,
  }),
}));

vi.mock("#product/hooks/agents/lifecycle/use-agents-pane-session-lifecycle", () => ({
  useAgentsPaneSessionLifecycle: (input: unknown) => {
    mocks.lifecycleInput(input);
    return { ...mocks.lifecycle };
  },
}));

vi.mock("#product/hooks/chat/derived/use-active-session-transcript-state", () => ({
  useTranscriptPaneStateForSession: () => ({ ...mocks.pane }),
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-lifecycle-actions", () => ({
  useAgentsPaneLifecycleActions: () => ({
    closeChild: mocks.closeChild,
    openChild: mocks.openChild,
    promoteChild: mocks.promoteChild,
    closePending: mocks.pending.close,
    openPending: mocks.pending.open,
    promotePending: mocks.pending.promote,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-intent-actions", () => ({
  useSessionIntentActions: () => ({ sendPrompt: mocks.sendPrompt }),
}));

function child(
  id: string,
  presentation: "running" | "available" | "closed",
  title = `Task ${id}`,
): SubagentRosterEntry {
  return {
    agent: {
      id,
      title,
      status: {
        execution: presentation === "running" ? "running" : "idle",
        hasLiveActor: presentation === "running",
        presentation,
      },
      configuration: { agentKind: "claude" },
      workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
    },
    relationship: {
      label: title,
      sessionLinkId: `link-${id}`,
    },
  } as unknown as SubagentRosterEntry;
}

function detailProps(entry: SubagentRosterEntry, id: string) {
  return {
    workspaceId: "workspace-1",
    parentSessionId: "parent-1",
    childSessionId: id,
    clientSessionId: `client-${id}`,
    child: entry,
    isPaneRouteActive: true,
    onBack: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function headerActionLabels(container: HTMLElement): string[] {
  const row = container.querySelector("header > div:last-child");
  return Array.from(row?.querySelectorAll("button") ?? [])
    .map((button) => button.textContent?.trim() ?? "");
}

function DetailTruthHarness({
  initialPresentation,
  onClosed,
  onOpened,
}: {
  initialPresentation: "running" | "closed";
  onClosed?: ReturnType<typeof vi.fn>;
  onOpened?: ReturnType<typeof vi.fn>;
}) {
  const [entry, setEntry] = useState(() => child("a", initialPresentation));
  const applyResponse = (outcome: { agent: SubagentRosterEntry["agent"] }) => {
    setEntry((current) => ({
      ...current,
      agent: { ...current.agent, ...outcome.agent, status: outcome.agent.status },
    }));
  };
  return (
    <AgentsPaneDetail
      {...detailProps(entry, "a")}
      onClosed={(outcome) => { applyResponse(outcome); onClosed?.(outcome); }}
      onOpened={(outcome) => {
        applyResponse(outcome);
        onOpened?.(outcome);
      }}
    />
  );
}

describe("AgentsPaneDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lifecycle.historyPhase = "ready";
    mocks.lifecycle.streamConnectionState = "open";
    mocks.lifecycle.streamRequestPending = false;
    mocks.messageListRows = 0;
    mocks.pane.transcript = { sessionId: "client-a" };
    mocks.pane.sessionViewState = "working";
    mocks.pending.close = false;
    mocks.pending.open = false;
    mocks.pending.promote = false;
    mocks.closeChild.mockResolvedValue({
      ok: true,
      agent: { status: { presentation: "closed" } },
      parentSessionId: "parent-1",
      childSessionId: "a",
      clientSessionId: "client-a",
    });
    mocks.openChild.mockResolvedValue({
      ok: true,
      agent: { status: { presentation: "available" } },
      presentation: "available",
      parentSessionId: "parent-1",
      childSessionId: "a",
      clientSessionId: "client-a",
    });
    mocks.promoteChild.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    ["running", ["Close", "Promote"], true],
    ["available", ["Close", "Promote"], true],
    ["closed", ["Open"], false],
  ] as const)("renders the %s action and composer contract", (presentation, actions, hasComposer) => {
    const entry = child("a", presentation);
    const { container } = render(<AgentsPaneDetail {...detailProps(entry, "a")} />);

    expect(headerActionLabels(container)).toEqual(actions);
    expect(container.querySelector("form") !== null).toBe(hasComposer);
    expect(screen.queryByTestId("message-list")).not.toBeNull();
    expect(mocks.messageListProps).toHaveBeenLastCalledWith(expect.objectContaining({
      onOpenSession: mocks.openTranscriptSession,
      canOpenSession: mocks.canOpenTranscriptSession,
    }));
    if (presentation === "available") {
      mocks.closeChild.mockReturnValueOnce(new Promise(() => {}));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mocks.closeChild).toHaveBeenCalledWith(expect.objectContaining({ childSessionId: "a" }));
    }
    if (presentation === "closed") {
      expect(screen.getByText("Closed. Transcript preserved and read-only.")).not.toBeNull();
      expect(mocks.messageListProps).toHaveBeenLastCalledWith(expect.objectContaining({
        sessionViewState: "idle",
      }));
    }
  });

  it.each(["running", "closed"] as const)(
    "contains a long %s transcript above its shrink-proof footer",
    (presentation) => {
      mocks.messageListRows = 80;
      render(<AgentsPaneDetail {...detailProps(child("a", presentation), "a")} />);

      const messageList = screen.getByTestId("message-list");
      expect(messageList.childElementCount).toBe(80);
      const transcriptSlot = messageList.parentElement;
      expect(transcriptSlot?.className).toBe(
        "flex min-h-0 flex-1 flex-col overflow-hidden",
      );

      const footer = transcriptSlot?.nextElementSibling;
      expect(footer?.tagName).toBe("FOOTER");
      expect(footer?.className.split(" ")).toContain("shrink-0");
      if (presentation === "closed") {
        expect(within(footer as HTMLElement).getByText(
          "Closed. Transcript preserved and read-only.",
        )).not.toBeNull();
      } else {
        expect(footer?.querySelector("form")).not.toBeNull();
      }
    },
  );

  it("uses exact neutral confirmation copy for Running Close and Promote", () => {
    const { container } = render(
      <AgentsPaneDetail {...detailProps(child("a", "running", "Audit auth"), "a")} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    let dialog = screen.getByRole("dialog", { name: "Close “Audit auth”?" });
    expect(dialog.textContent).toContain(
      "This immediately interrupts the current turn, discards queued prompts, and preserves the transcript. You can open this subagent again later.",
    );
    expect(within(dialog).getByRole("button", { name: "Close" }).dataset.variant).toBe("primary");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    dialog = screen.getByRole("dialog", { name: "Promote “Audit auth”?" });
    expect(dialog.textContent).toContain(
      "It becomes a top-level session in this workspace’s tabs, keeps its transcript, and can spawn its own subagents.",
    );
    expect(within(dialog).getByRole("button", { name: "Promote" }).dataset.variant).toBe("primary");
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it("makes an accepted Close response immediate Closed truth while the roster is stale", async () => {
    const onClosed = vi.fn();
    render(<DetailTruthHarness initialPresentation="running" onClosed={onClosed} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByText(
      "Closed. Transcript preserved and read-only.",
    )).not.toBeNull());
    expect(screen.getByRole("button", { name: "Open" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(mocks.closeChild).toHaveBeenCalledWith({
      parentSessionId: "parent-1",
      childSessionId: "a",
      clientSessionId: "client-a",
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("makes an accepted Open response immediate writable truth while the roster is stale", async () => {
    const onOpened = vi.fn();
    render(<DetailTruthHarness initialPresentation="closed" onOpened={onOpened} />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Close" })).not.toBeNull());
    expect(screen.getByRole("button", { name: "Promote" })).not.toBeNull();
    expect(document.querySelector("form")).not.toBeNull();
    expect(screen.queryByText("Closed. Transcript preserved and read-only.")).toBeNull();
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it("keeps the child writable when Close fails", async () => {
    const failure = { ok: false, action: "close", kind: "unknown" };
    const onLifecycleError = vi.fn();
    mocks.closeChild.mockResolvedValue(failure);
    render(
      <AgentsPaneDetail
        {...detailProps(child("a", "running"), "a")}
        onLifecycleError={onLifecycleError}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(onLifecycleError).toHaveBeenCalledWith(failure));
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Promote" })).not.toBeNull();
    expect(document.querySelector("form")).not.toBeNull();
    expect(screen.queryByText("Closed. Transcript preserved and read-only.")).toBeNull();
  });

  it("does not let a late Open for child A contaminate Closed child B", async () => {
    const openA = deferred<{
      ok: true;
      presentation: "available";
      parentSessionId: string;
      childSessionId: string;
      clientSessionId: string;
    }>();
    mocks.openChild.mockReturnValueOnce(openA.promise);
    const view = render(
      <AgentsPaneDetail {...detailProps(child("a", "closed"), "a")} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    view.rerender(
      <AgentsPaneDetail {...detailProps(child("b", "closed"), "b")} />,
    );
    await act(async () => {
      openA.resolve({
        ok: true,
        presentation: "available",
        parentSessionId: "parent-1",
        childSessionId: "a",
        clientSessionId: "client-a",
      });
      await openA.promise;
    });

    expect(screen.getByText("Closed · Claude")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).not.toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(mocks.openChild).toHaveBeenCalledTimes(1);
    expect(mocks.openChild).toHaveBeenCalledWith({
      parentSessionId: "parent-1",
      childSessionId: "a",
      clientSessionId: "client-a",
    });
    expect(mocks.openChild).not.toHaveBeenCalledWith(expect.objectContaining({
      childSessionId: "b",
    }));
  });

  it("scopes both confirmation dialogs to the durable child identity", () => {
    const view = render(
      <AgentsPaneDetail {...detailProps(child("a", "running"), "a")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Close “Task a”?" })).not.toBeNull();

    view.rerender(
      <AgentsPaneDetail {...detailProps(child("b", "running"), "b")} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(screen.queryByRole("dialog", { name: "Promote “Task b”?" })).not.toBeNull();

    view.rerender(
      <AgentsPaneDetail {...detailProps(child("a", "running"), "a")} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders identity, provider, busy/error, connection, and composer safety states", () => {
    const entry = child("a", "running");
    const view = render(<AgentsPaneDetail {...detailProps(entry, "a")} />);

    expect(screen.getByTestId("agent-glyph").dataset.dimension).toBe("20");
    expect(screen.getByText("Running · Claude")).not.toBeNull();
    expect(view.container.querySelector("section")?.getAttribute("aria-busy")).toBe("false");
    expect(view.container.querySelector("textarea")?.hasAttribute("data-telemetry-mask")).toBe(true);
    expect(mocks.lifecycleInput).toHaveBeenLastCalledWith(expect.objectContaining({
      childSessionId: "a",
      clientSessionId: "client-a",
      isClosed: false,
    }));

    mocks.pending.close = true;
    view.rerender(<AgentsPaneDetail {...detailProps(entry, "a")} />);
    const busyClose = screen.getByRole("button", { name: "Close" }) as HTMLButtonElement;
    expect(busyClose.disabled).toBe(true);
    expect(busyClose.dataset.loading).toBe("true");
    mocks.pending.close = false;

    mocks.lifecycle.streamConnectionState = "disconnected";
    mocks.lifecycle.streamRequestPending = true;
    view.rerender(<AgentsPaneDetail {...detailProps(entry, "a")} />);
    expect(screen.getByText("Connecting…")).not.toBeNull();
    expect(screen.queryByText("Live updates paused")).toBeNull();
    expect(view.container.querySelector("section")?.getAttribute("aria-busy")).toBe("true");

    mocks.lifecycle.streamRequestPending = false;
    view.rerender(<AgentsPaneDetail {...detailProps(entry, "a")} />);
    expect(screen.getByText("Live updates paused")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(mocks.lifecycle.reconnect).toHaveBeenCalledTimes(1);

    mocks.lifecycle.historyPhase = "error";
    view.rerender(<AgentsPaneDetail {...detailProps(entry, "a")} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn’t load this subagent’s transcript.",
    );
    expect(document.querySelector("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.lifecycle.retryHistory).toHaveBeenCalledTimes(1);
  });

  it("offers manual reconnect when an externally owned live stream ends", () => {
    mocks.lifecycle.streamConnectionState = "ended";
    render(<AgentsPaneDetail {...detailProps(child("a", "running"), "a")} />);

    expect(screen.getByText("Live updates paused")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(mocks.lifecycle.reconnect).toHaveBeenCalledTimes(1);
  });

  it("sends to the mapped child without changing another active main session", () => {
    render(<AgentsPaneDetail {...detailProps(child("a", "available"), "a")} />);
    const textarea = screen.getByRole("textbox", { name: /message/i });

    fireEvent.change(textarea, { target: { value: "Line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(mocks.sendPrompt).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.sendPrompt).toHaveBeenCalledWith({
      sessionId: "client-a",
      workspaceId: "workspace-1",
      text: "Line one",
    });
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });
});
