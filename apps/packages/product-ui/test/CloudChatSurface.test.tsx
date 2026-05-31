// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudChatSurface,
  type CloudChatHeaderView,
} from "../src/chat/CloudChatSurface";

describe("CloudChatSurface", () => {
  afterEach(cleanup);

  it("renders workspace/session breadcrumb without a redundant session label", () => {
    renderSurface();

    expect(screen.getByText("Bramble")).toBeTruthy();
    expect(screen.getByText("/")).toBeTruthy();
    expect(screen.getByText("Starting")).toBeTruthy();
    expect(screen.queryByText("Session")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    const switcher = screen.getByRole("button", {
      name: /Switch sessions in Bramble/u,
    });
    expect(switcher.textContent).toContain("Fix auth flow");
  });

  it("selects sessions and starts a new session from the header", () => {
    const onSelectSession = vi.fn();
    const onNewSession = vi.fn();

    renderSurface({
      sessionSwitcher: {
        ...baseHeader.sessionSwitcher,
        onSelectSession,
        onNewSession,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Switch sessions in Bramble/u }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Second pass/u }));
    expect(onSelectSession).toHaveBeenCalledWith("session-2");

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("shows notice diagnostics behind details and emits copy", () => {
    const onCopy = vi.fn();

    renderSurface({
      notice: {
        title: "Workspace accepted.",
        description: "Preparing the selected runtime so this session can start.",
        tone: "info",
        diagnostics: {
          text: "workspace=workspace-1 · target=target-1",
          onCopy,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Details/u }));

    expect(screen.getByText("workspace=workspace-1 · target=target-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("shows a transcript skeleton without replacing the loaded shell", () => {
    renderSurface({}, { transcriptLoading: true });

    expect(screen.getByText("Bramble")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Switch sessions in Bramble/u })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading session content" })).toBeTruthy();
    expect(screen.queryByText("No transcript yet")).toBeNull();
  });
});

const baseHeader: CloudChatHeaderView = {
  workspaceLabel: "Bramble",
  status: {
    label: "Starting",
    tone: "info",
    live: true,
  },
  sessionSwitcher: {
    workspaceLabel: "Bramble",
    activeSessionId: "session-1",
    activeSessionLabel: "Fix auth flow",
    sessions: [
      {
        id: "session-1",
        label: "Fix auth flow",
        detail: "2m",
        statusLabel: "In progress",
      },
      {
        id: "session-2",
        label: "Second pass",
        detail: "1h",
        statusLabel: "Ready",
      },
    ],
    newSessionLabel: "New session",
    onSelectSession: vi.fn(),
    onNewSession: vi.fn(),
  },
  desktopAction: {
    label: "Open in Desktop",
    kind: "desktop",
    onClick: vi.fn(),
  },
};

function renderSurface(
  header: Partial<CloudChatHeaderView> = {},
  options: { transcriptLoading?: boolean } = {},
) {
  return render(
    <CloudChatSurface
      header={{ ...baseHeader, ...header }}
      transcriptRows={[]}
      transcriptLoading={options.transcriptLoading}
      emptyTitle="No transcript yet"
      composer={{
        value: "",
        placeholder: "Describe a task",
        canSubmit: false,
        onChange: vi.fn(),
        onSubmit: vi.fn(),
        controls: [],
      }}
    />,
  );
}
