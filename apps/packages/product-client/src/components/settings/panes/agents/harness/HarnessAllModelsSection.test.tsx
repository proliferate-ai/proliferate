// @vitest-environment jsdom

import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

const FIXED_NOW = new Date("2026-08-21T12:00:00Z").getTime();

function isoAgo(ms: number, from: number = FIXED_NOW): string {
  return new Date(from - ms).toISOString();
}

type LaunchOptionsFixture = Record<string, unknown> | undefined;

/** The status text (aria-live), scoped away from identical collapsed body copy. */
function contentLine(): HTMLElement {
  const node = document.querySelector('[aria-live="polite"]');
  if (!node) throw new Error("content line container not found");
  return node as HTMLElement;
}

const state = vi.hoisted(() => ({
  launchOptions: undefined as LaunchOptionsFixture,
  isLoading: false,
  isError: false,
  refresh: vi.fn(),
  refetch: vi.fn(),
  // Set by the stale-detecting convergence test: when present, the fake
  // query hook below transitions from `launchOptions` to this fixture after
  // one probe interval, with no user action in between.
  nextLaunchOptions: undefined as LaunchOptionsFixture,
  // Cloud-surface fixtures (E-R5), stateful like `launchOptions` above.
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => {
    // A minimal stand-in for slice B's real polling hook: it reacts to time
    // passing, not to anything the test clicks, so a test that only advances
    // fake timers is proof the render updates with no user action.
    const [data, setData] = useState(state.launchOptions);
    useEffect(() => {
      setData(state.launchOptions);
    }, [state.launchOptions]);
    useEffect(() => {
      if (!state.nextLaunchOptions) return undefined;
      const timer = setTimeout(() => {
        setData(state.nextLaunchOptions);
      }, 1500);
      return () => clearTimeout(timer);
    }, [data]);
    // v5 shape the component now depends on: a DISABLED query is pending with
    // an IDLE fetchStatus; only a real request in flight is non-idle.
    const isPending = data === undefined && !state.isError;
    const fetchStatus = state.isLoading ? "fetching" : "idle";
    return { data, isLoading: state.isLoading, isError: state.isError, isPending, fetchStatus, refetch: state.refetch };
  },
  useRefreshHarnessLaunchOptionsMutation: () => ({
    mutate: state.refresh,
    isPending: false,
  }),
}));


vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  // Desktop: the surface this whole matrix describes.
  useProductHost: () => ({ desktop: { runtime: { restart: vi.fn() } } }),
}));

vi.mock("#product/lib/access/anyharness/runtime-bootstrap", () => ({
  restartHarnessRuntime: vi.fn(),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (value: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  useHarnessConnectionStore.setState({ connectionState: "healthy" });
  state.refresh.mockReset();
  state.refetch.mockReset();
  state.isLoading = false;
  state.isError = false;
  state.nextLaunchOptions = undefined;
  state.launchOptions = {
    harnessKind: "claude",
    basisRevision: "basis-1",
    revision: 7,
    state: "observed",
    options: {
      models: [
        { id: "fable", observedName: "Fable", observedDescription: null },
        { id: "unknown-upstream-id", observedName: null, observedDescription: null },
      ],
      controls: [],
      defaults: { modelId: "fable", controlValues: {} },
    },
    observedAt: "2026-08-19T00:00:00Z",
    probeAttemptedAt: "2026-08-19T00:00:00Z",
    probeFailureCode: null,
    readiness: "ready", canManuallyRefresh: true,
  };
});

describe("HarnessAllModelsSection", () => {
  it("renders every target-observed model without visibility switches", () => {
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    fireEvent.click(screen.getByRole("button", { name: "Models" }));

    expect(screen.getByText("Fable")).toBeTruthy();
    expect(screen.getByText("unknown-upstream-id")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("requests an override-free refresh for the same harness", () => {
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    expect(state.refresh).toHaveBeenCalledWith("claude", expect.anything());
  });
});

describe("HarnessAllModelsSection — the eight models-section states", () => {
  it("1 · initial HTTP loading: no count, Refresh disabled", () => {
    state.isLoading = true;
    state.launchOptions = undefined;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(within(contentLine()).getByText("Loading models…")).toBeTruthy();
    expect(screen.queryByText(/^\d+ models?$/)).toBeNull();
    // Round 5: no payload means no ownership fact to read, so the control fails
    // closed. It was enabled here, which was never a cure anyway: a read that is
    // already in flight does not land sooner because you pressed Refresh.
    expect((screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("2 · active first observation: Checking copy, never a count, Refresh disabled-as-busy", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "detecting",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "running",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Cursor" surface="local" />);

    expect(within(contentLine()).getByText("Checking available models…")).toBeTruthy();
    expect(screen.queryByText(/^0 models/)).toBeNull();
    const refreshButton = screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
  });

  it("3 · idle-unobserved (Cursor fixture): calm static copy, Refresh ENABLED", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "detecting",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Cursor" surface="local" />);

    expect(screen.getByText("Models haven't been detected yet")).toBeTruthy();
    expect(screen.getByText("· Cursor reports models after its first launch. Refresh checks now.")).toBeTruthy();
    const refreshButton = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(false);
  });

  it("4 · observed: count in foreground, freshness suffix muted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 4,
      state: "observed",
      options: {
        models: Array.from({ length: 180 }, (_, i) => ({ id: `m-${i}`, observedName: `Model ${i}`, observedDescription: null })),
        controls: [],
        defaults: { modelId: null, controlValues: {} },
      },
      observedAt: isoAgo(2 * 60_000),
      probeAttemptedAt: isoAgo(2 * 60_000),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="OpenCode" surface="local" />);

    expect(screen.getByText("180 models")).toBeTruthy();
    expect(screen.getByText("· refreshed 2m ago")).toBeTruthy();
  });

  it("5 · observed-empty: calm honest zero, no error tone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 5,
      state: "observed_empty",
      options: { models: [], controls: [], defaults: { modelId: null, controlValues: {} } },
      observedAt: isoAgo(5 * 60_000),
      probeAttemptedAt: isoAgo(5 * 60_000),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="OpenCode" surface="local" />);

    expect(screen.getByText("0 models")).toBeTruthy();
    expect(screen.getByText("· OpenCode reported none · refreshed 5m ago")).toBeTruthy();
  });

  it("6 · last-good-after-failure: prior list stays, undimmed, one refresh-failed line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 6,
      state: "last_good_after_failure",
      options: {
        models: Array.from({ length: 180 }, (_, i) => ({ id: `m-${i}`, observedName: `Model ${i}`, observedDescription: null })),
        controls: [],
        defaults: { modelId: null, controlValues: {} },
      },
      observedAt: isoAgo(3 * 60 * 60_000),
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: "harness_probe_failed",
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="OpenCode" surface="local" />);

    expect(screen.getByText("180 models")).toBeTruthy();
    expect(screen.getByText("· last refresh failed · refreshed 3h ago")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("7 · failed-without-observation: explicit failure with an enabled Retry, no count", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 7,
      state: "failed_without_observation",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: "harness_probe_failed",
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Cursor" surface="local" />);

    expect(screen.getByText("Couldn't check models")).toBeTruthy();
    expect(screen.getByText("· Cursor didn't answer the probe.")).toBeTruthy();
    expect(screen.queryByText(/^\d+ models?/)).toBeNull();
    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    expect(state.refresh).toHaveBeenCalledWith("claude", expect.anything());
  });

  it("8 · transport error: launch-options request itself failed, Retry refetches", () => {
    state.launchOptions = undefined;
    state.isError = true;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("Models couldn't be loaded")).toBeTruthy();
    expect(screen.getByText("· The runtime didn't respond.")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(state.refetch).toHaveBeenCalled();
  });
});

describe("HarnessAllModelsSection — self-curing refresh", () => {
  it("converges a stale-detecting fixture to observed with no user action", () => {
    vi.useFakeTimers();
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "detecting",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(32 * 60_000, FIXED_NOW),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "running",
    };
    state.nextLaunchOptions = {
      harnessKind: "claude",
      basisRevision: "b2",
      revision: 2,
      state: "observed",
      options: {
        models: Array.from({ length: 180 }, (_, i) => ({ id: `m-${i}`, observedName: `Model ${i}`, observedDescription: null })),
        controls: [],
        defaults: { modelId: null, controlValues: {} },
      },
      observedAt: isoAgo(0, FIXED_NOW),
      probeAttemptedAt: isoAgo(0, FIXED_NOW),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="OpenCode" surface="local" />);

    expect(within(contentLine()).getByText("Checking available models…")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText("180 models")).toBeTruthy();
    expect(screen.queryByText("Checking available models…")).toBeNull();
  });

  it("rereads the durable failed_without_observation state after a refresh-mutation 5xx", () => {
    const { rerender } = render(<HarnessAllModelsSection harnessKind="claude" displayName="Cursor" surface="local" />);

    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    const [, mutateOptions] = state.refresh.mock.calls[0] as [string, { onError?: (error: Error) => void }];

    // The 5xx: the mutation's own onError durably records
    // failed_without_observation and invalidates the cache (agents.ts), so
    // the next read this client sees is the durable failure, not a bounce
    // back to the pre-refresh revision.
    mutateOptions.onError?.(new Error("Internal Server Error"));
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b3",
      revision: 8,
      state: "failed_without_observation",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: "harness_probe_failed",
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    rerender(<HarnessAllModelsSection harnessKind="claude" displayName="Cursor" surface="local" />);

    expect(screen.getByText("Couldn't check models")).toBeTruthy();
    expect(screen.getByText("· Cursor didn't answer the probe.")).toBeTruthy();
  });
});

describe("HarnessAllModelsSection — truthfulness rules", () => {
  it("never renders a count during loading or first observation", () => {
    state.isLoading = true;
    state.launchOptions = undefined;
    const { rerender } = render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    expect(screen.queryByText(/\d+ models?/)).toBeNull();

    state.isLoading = false;
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "detecting",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "running",
    };
    rerender(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    expect(screen.queryByText(/\d+ models?/)).toBeNull();
  });

  it("never renders the freshness suffix without observedAt", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "observed",
      options: { models: [], controls: [], defaults: { modelId: null, controlValues: {} } },
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "idle",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("0 models")).toBeTruthy();
    expect(screen.queryByText(/refreshed/)).toBeNull();
    // E-R11: an exact-string `queryByText` for a bare wire state can never
    // match (the muted span concatenates " · " into one text node), so assert
    // on the container's full text, covering every raw state string.
    expect(contentLine().textContent).not.toMatch(
      /detecting|refreshing|observed|last_good_after_failure|failed_without_observation/,
    );
  });
});

describe("HarnessAllModelsSection — queued counts as live (E-R2)", () => {
  it("detecting+queued renders Checking, Refresh disabled-as-busy", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "detecting",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "queued",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Cursor" surface="local" />);

    expect(within(contentLine()).getByText("Checking available models…")).toBeTruthy();
    expect(screen.queryByText("Models haven't been detected yet")).toBeNull();
    const refreshButton = screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
  });

  it("refreshing+queued renders Checking, Refresh disabled-as-busy (not enabled/non-spinning)", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 2,
      state: "refreshing",
      options: {
        models: [{ id: "m-1", observedName: "Model 1", observedDescription: null }],
        controls: [],
        defaults: { modelId: null, controlValues: {} },
      },
      observedAt: isoAgo(60_000),
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "queued",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Cursor" surface="local" />);

    expect(within(contentLine()).getByText("Checking available models…")).toBeTruthy();
    const refreshButton = screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
    expect(refreshButton.className).toContain("disabled:opacity-100");
  });
});

describe("HarnessAllModelsSection — cloud surface", () => {
  it("renders nothing: the copied cloud launch-options store died with the sandbox stack", () => {
    const { container } = render(
      <HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="cloud" />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("HarnessAllModelsSection — round 2 review fixes", () => {
  it("E-R9: a terminal state carrying a stray live probePhase keeps Refresh enabled", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 5,
      state: "observed",
      options: { models: [{ id: "m-1", observedName: "Model 1", observedDescription: null }], controls: [], defaults: { modelId: null, controlValues: {} } },
      observedAt: isoAgo(60_000),
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: null,
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "queued",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    expect(screen.getByText("1 model")).toBeTruthy();
    const refreshButton = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Refreshing…" })).toBeNull();
  });

  it("E-R10: failed_without_observation with a live probePhase shows one consistent affordance", () => {
    state.launchOptions = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 9,
      state: "failed_without_observation",
      options: null,
      observedAt: null,
      probeAttemptedAt: isoAgo(0),
      probeFailureCode: "harness_probe_failed",
      readiness: "ready", canManuallyRefresh: true,
      probePhase: "running",
    };
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    expect(screen.getByText("Couldn't check models")).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(false);
    const refreshButton = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Refreshing…" })).toBeNull();
  });

});
