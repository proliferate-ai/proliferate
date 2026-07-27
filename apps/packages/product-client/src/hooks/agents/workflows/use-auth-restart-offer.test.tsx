// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAuthSelection } from "@proliferate/cloud-sdk";
import { useAuthRestartOffer } from "#product/hooks/agents/workflows/use-auth-restart-offer";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

const mocks = vi.hoisted(() => ({
  useAuthSelections: vi.fn(),
  restartSessionsOnNewAuth: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAuthSelections: mocks.useAuthSelections,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudEnabled: true,
    authStatus: "authenticated",
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: null,
    cloud: { client: { baseUrl: "https://api.example.test" } },
  }),
}));

vi.mock("#product/lib/access/anyharness/session-restart", () => ({
  restartSessionsOnNewAuth: mocks.restartSessionsOnNewAuth,
}));

function selection(
  harnessKind: string,
  surface: "local" | "cloud",
  applied: boolean | null | undefined,
): AgentAuthSelection {
  return {
    id: `${harnessKind}:${surface}`,
    harnessKind,
    surface,
    sourceKind: "gateway",
    apiKeyId: null,
    keyTitle: null,
    envVarName: null,
    providerHint: null,
    enabled: true,
    ...(applied === undefined ? {} : { applied }),
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
  };
}

function seedSession(
  sessionId: string,
  agentKind: string,
  workspaceId: string,
  status: "running" | "idle" | "starting" = "running",
) {
  useSessionDirectoryStore.getState().upsertEntry({
    sessionId,
    agentKind,
    workspaceId,
    status,
  });
}

function renderOffer(initial: AgentAuthSelection[] | undefined) {
  let selections = initial;
  mocks.useAuthSelections.mockImplementation(() => ({ data: selections }));
  const rendered = renderHook(() => useAuthRestartOffer());
  return {
    ...rendered,
    setSelections(next: AgentAuthSelection[]) {
      selections = next;
      rendered.rerender();
    },
  };
}

describe("useAuthRestartOffer", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers once on the pending→applied flip, scoped to the switched harness+surface (Proof C6)", () => {
    seedSession("match-1", "claude", "ws-1");
    seedSession("match-2", "claude", "ws-2");
    seedSession("other-harness", "codex", "ws-1");
    seedSession("other-surface", "claude", "cloud:cw-1");
    seedSession("idle", "claude", "ws-1", "idle");

    const view = renderOffer([selection("claude", "local", false)]);
    expect(view.result.current.offer).toBeNull();

    view.setSelections([selection("claude", "local", true)]);
    expect(view.result.current.offer).toEqual({ harnessKind: "claude", surface: "local" });
    expect(view.result.current.offeredSessions.map((entry) => entry.sessionId))
      .toEqual(["match-1", "match-2"]);

    // Fires once: re-observing the same applied state re-offers nothing new,
    // and after a decline the offer stays gone.
    act(() => view.result.current.decline());
    view.rerender();
    expect(view.result.current.offer).toBeNull();
    view.setSelections([selection("claude", "local", true)]);
    expect(view.result.current.offer).toBeNull();
  });

  it("never offers for a scope that was applied from the first observation", () => {
    seedSession("running", "claude", "ws-1");
    const view = renderOffer([selection("claude", "local", true)]);
    view.rerender();
    expect(view.result.current.offer).toBeNull();
  });

  it("shows no modal when the switched scope has no running sessions", () => {
    seedSession("idle", "claude", "ws-1", "idle");
    seedSession("wrong-surface", "claude", "cloud:cw-1");
    const view = renderOffer([selection("claude", "local", false)]);
    view.setSelections([selection("claude", "local", true)]);
    expect(view.result.current.offer).toBeNull();
  });

  it("scopes a cloud switch to cloud-sandbox sessions", () => {
    seedSession("cloud-1", "claude", "cloud:cw-1");
    seedSession("local-1", "claude", "ws-1");
    const view = renderOffer([selection("claude", "cloud", false)]);
    view.setSelections([selection("claude", "cloud", true)]);
    expect(view.result.current.offer).toEqual({ harnessKind: "claude", surface: "cloud" });
    expect(view.result.current.offeredSessions.map((entry) => entry.sessionId))
      .toEqual(["cloud-1"]);
  });

  it("re-scopes to a later switch that acks before the modal is answered (latest-wins)", () => {
    seedSession("claude-1", "claude", "ws-1");
    seedSession("codex-1", "codex", "ws-1");

    const view = renderOffer([
      selection("claude", "local", false),
      selection("codex", "local", true),
    ]);
    view.setSelections([
      selection("claude", "local", true),
      selection("codex", "local", true),
    ]);
    expect(view.result.current.offer).toEqual({ harnessKind: "claude", surface: "local" });

    // A second switch (codex) goes pending and then acks while the claude
    // modal is still open: the offer re-scopes to the newest switch.
    view.setSelections([
      selection("claude", "local", true),
      selection("codex", "local", false),
    ]);
    view.setSelections([
      selection("claude", "local", true),
      selection("codex", "local", true),
    ]);
    expect(view.result.current.offer).toEqual({ harnessKind: "codex", surface: "local" });
    expect(view.result.current.offeredSessions.map((entry) => entry.sessionId))
      .toEqual(["codex-1"]);
  });

  it("restarts the sessions matching at ANSWER time, concurrently via the executor", () => {
    seedSession("early", "claude", "ws-1");
    const view = renderOffer([selection("claude", "local", false)]);
    view.setSelections([selection("claude", "local", true)]);
    expect(view.result.current.offer).not.toBeNull();

    // A new matching session starts while the modal is open; answering
    // applies to the sessions matching at answer time.
    seedSession("late", "claude", "ws-2");
    act(() => view.result.current.restartNow());

    expect(mocks.restartSessionsOnNewAuth).toHaveBeenCalledTimes(1);
    const [targets] = mocks.restartSessionsOnNewAuth.mock.calls[0]!;
    expect(targets).toEqual([
      { sessionId: "early", workspaceId: "ws-1" },
      { sessionId: "late", workspaceId: "ws-2" },
    ]);
    view.rerender();
    expect(view.result.current.offer).toBeNull();
  });

  it("declining is stateless: nothing restarts, nothing persists, and a later switch re-offers", () => {
    seedSession("running", "claude", "ws-1");
    const view = renderOffer([selection("claude", "local", false)]);
    view.setSelections([selection("claude", "local", true)]);
    expect(view.result.current.offer).not.toBeNull();

    act(() => view.result.current.decline());
    view.rerender();
    expect(view.result.current.offer).toBeNull();
    expect(mocks.restartSessionsOnNewAuth).not.toHaveBeenCalled();

    // No suppression lingers: the next switch offers again.
    view.setSelections([selection("claude", "local", false)]);
    view.setSelections([selection("claude", "local", true)]);
    expect(view.result.current.offer).toEqual({ harnessKind: "claude", surface: "local" });
  });
});
