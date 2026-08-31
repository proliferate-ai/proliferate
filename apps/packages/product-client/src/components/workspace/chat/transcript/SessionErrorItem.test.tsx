/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ErrorItem } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionErrorItem } from "#product/components/workspace/chat/transcript/SessionErrorItem";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";

vi.mock("#product/hooks/sessions/workflows/use-session-model-fallback-action", () => ({
  useSessionModelFallbackAction: () => vi.fn(),
}));

const createEmptySessionWithResolvedConfig = vi.hoisted(() =>
  vi.fn().mockResolvedValue("new-session-1")
);
vi.mock("#product/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createEmptySessionWithResolvedConfig,
    createSessionWithResolvedConfig: vi.fn(),
  }),
}));

const getSessionRecordMock = vi.hoisted(() => vi.fn());
vi.mock("#product/stores/sessions/session-records", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionRecord: getSessionRecordMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useModelSupportStore.setState({ refusalsByKey: {}, pickerRequestNonce: 0 });
});

describe("SessionErrorItem", () => {
  it("keeps provider diagnostics behind Details and opens model recovery", () => {
    const raw = `Internal error: undefined: The provided model identifier is invalid.: {
  "errorName": "APIError",
  "service": "session"
}`;
    const { container } = render(
      <SessionErrorItem
        item={errorItem({
          code: "provider_model_unavailable",
          message: raw,
          sourceAgentKind: "opencode",
        })}
        sessionId="session-1"
      />,
    );

    expect(screen.getByText("Model unavailable")).toBeTruthy();
    expect(container.textContent).not.toContain("Internal error: undefined");

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(container.textContent).toContain("Internal error: undefined");

    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    expect(useModelSupportStore.getState().pickerRequestNonce).toBe(1);
    expect(useModelSupportStore.getState().refusalsByKey).toEqual({});
  });

  it("offers a one-click relaunch on a seat plan-limit death", () => {
    getSessionRecordMock.mockReturnValue({
      sessionId: "session-1",
      agentKind: "claude",
      modelId: "claude-opus-4-7",
      requestedModelId: null,
      workspaceId: "workspace-1",
    });
    render(
      <SessionErrorItem
        item={errorItem({
          code: "seat_usage_limit",
          message: "seat usage limit reached",
          details: {
            kind: "seat_usage_limit",
            seatId: "seat-1",
            window: "five_hour",
            resetAt: "2026-01-05T18:00:00Z",
          } as unknown as ErrorItem["details"],
        })}
        sessionId="session-1"
      />,
    );

    expect(screen.getByText("Claude.ai plan limit reached")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Relaunch session/ }));

    // The dead session's own parameters ride the ordinary create path; the
    // next launch lands on the next login via the runtime's seat ladder.
    expect(createEmptySessionWithResolvedConfig).toHaveBeenCalledTimes(1);
    expect(createEmptySessionWithResolvedConfig).toHaveBeenCalledWith({
      agentKind: "claude",
      modelId: "claude-opus-4-7",
      workspaceId: "workspace-1",
    });
  });
});

function errorItem(overrides: Partial<ErrorItem>): ErrorItem {
  return {
    kind: "error",
    itemId: "error-1",
    turnId: "turn-1",
    status: "failed",
    sourceAgentKind: "opencode",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-08-21T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-08-21T00:00:00Z",
    message: "Something failed",
    code: null,
    details: null,
    ...overrides,
  };
}
