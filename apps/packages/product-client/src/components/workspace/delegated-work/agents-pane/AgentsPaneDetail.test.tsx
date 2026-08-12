// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { SubagentRosterEntry } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPaneDetail } from "#product/components/workspace/delegated-work/agents-pane/AgentsPaneDetail";

const mocks = vi.hoisted(() => ({
  lifecycleInput: vi.fn(),
  glyphProps: vi.fn(),
  messageListProps: vi.fn(),
  sendPrompt: vi.fn(),
  closeChild: vi.fn(),
  openChild: vi.fn(),
  promoteChild: vi.fn(),
  lifecycle: {
    historyPhase: "ready" as "loading" | "ready" | "error",
    streamConnectionState: "connected" as "connecting" | "connected" | "disconnected" | null,
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
    return <div data-testid="message-list" />;
  },
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
  return Array.from(row?.querySelectorAll("button") ?? []).map(
    (button) => button.textContent?.trim() ?? "",
  );
}

describe("AgentsPaneDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lifecycle.historyPhase = "ready";
    mocks.lifecycle.streamConnectionState = "connected";
    mocks.lifecycle.streamRequestPending = false;
    mocks.pane.transcript = { sessionId: "client-a" };
    mocks.pane.sessionViewState = "working";
    mocks.pending.close = false;
    mocks.pending.open = false;
    mocks.pending.promote = false;
    mocks.closeChild.mockResolvedValue({ ok: true, agent: { status: { presentation: "closed" } } });
    mocks.openChild.mockResolvedValue({ ok: true, presentation: "available" });
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
    render(
      <AgentsPaneDetail
        {...detailProps(child("a", "running"), "a")}
        onClosed={onClosed}
      />,
    );

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
    const openA = deferred<{ ok: true; presentation: "available" }>();
    mocks.openChild.mockReturnValueOnce(openA.promise);
    const view = render(
      <AgentsPaneDetail {...detailProps(child("a", "closed"), "a")} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    view.rerender(
      <AgentsPaneDetail {...detailProps(child("b", "closed"), "b")} />,
    );
    await act(async () => {
      openA.resolve({ ok: true, presentation: "available" });
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
});
