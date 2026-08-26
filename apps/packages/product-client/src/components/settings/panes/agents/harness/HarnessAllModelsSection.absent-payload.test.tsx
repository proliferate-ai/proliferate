// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

/**
 * The ways a launch-options payload can be absent, kept apart.
 *
 * `HarnessAllModelsSection.test.tsx` owns the (state x probePhase) matrix,
 * which by definition has a payload. These cases have none, and the whole
 * point of the pane is that "no payload" is not one condition: a request in
 * flight, a query nobody enabled, a query with no host to enable it against,
 * and several distinct ways a request can fail are different truths and must
 * render as different things. The second describe below carries the cases
 * where the READ has settled and only the refresh control can still lie.
 *
 * The fakes mirror TanStack v5 exactly: a DISABLED query reports
 * `isPending: true` with `fetchStatus: "idle"`, which is what makes
 * `isPending` alone unusable as an "in flight" signal, and a PARKED mutation
 * reports `isPending: true` with `isPaused: true` for the same reason.
 */

const runtimeQuery = vi.hoisted(() => ({
  data: undefined as Record<string, unknown> | undefined,
  isError: false,
  isPending: true,
  fetchStatus: "idle" as "idle" | "fetching",
  refetch: vi.fn(),
}));

/** The refresh mutation, whose parked-vs-running distinction is E-R28. */
const refreshMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isPaused: false,
}));

/**
 * The desktop runtime bridge, or null to stand in for Web. The real
 * `useLocalRuntimeRestart` runs against this, so "Retry restarts the runtime"
 * is proven through the production seam rather than a mocked-out hook.
 */
const host = vi.hoisted(() => ({
  desktop: null as { runtime: { restart: () => void } } | null,
}));
const restartHarnessRuntime = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => host,
}));

vi.mock("#product/lib/access/anyharness/runtime-bootstrap", () => ({
  restartHarnessRuntime,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => runtimeQuery,
  useRefreshHarnessLaunchOptionsMutation: () => refreshMutation,
}));



vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (value: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

afterEach(cleanup);

beforeEach(() => {
  // Local default: the runtime is still coming up, which is the fact that
  // disables the query — not something inferred from the query itself.
  useHarnessConnectionStore.setState({ connectionState: "connecting" });
  runtimeQuery.data = undefined;
  runtimeQuery.isError = false;
  runtimeQuery.isPending = true;
  runtimeQuery.fetchStatus = "idle";
  runtimeQuery.refetch.mockReset();
  refreshMutation.mutate.mockReset();
  refreshMutation.isPending = false;
  refreshMutation.isPaused = false;
  // Desktop by default: the host that actually has a local runtime.
  host.desktop = { runtime: { restart: vi.fn() } };
  restartHarnessRuntime.mockReset();
});

describe("HarnessAllModelsSection — no payload, nothing in flight (round 3)", () => {
  it("E-R17: a local runtime still connecting is not an error and not a spinner", () => {
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("Connecting to the local runtime")).toBeTruthy();
    expect(screen.getByText("· Models load as soon as it's ready.")).toBeTruthy();
    // Nothing failed, so no failure claim and no cure to offer.
    expect(screen.queryByText("Models couldn't be loaded")).toBeNull();
    expect(screen.queryByText("· The runtime didn't respond.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    // Nothing is running, so no spinner either.
    expect(screen.queryByText("Loading models…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refreshing…" })).toBeNull();
    // `refresh_now` cannot reach a runtime that is not up: disabled, and NOT
    // wearing the busy-with-full-ink treatment.
    const refresh = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(refresh.className).not.toContain("disabled:opacity-100");
    expect(refresh.querySelector(".animate-spin")).toBeNull();
  });

  it("E-R17: it stops claiming anything once the runtime answers", () => {
    const { rerender } = render(
      <HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />,
    );
    expect(screen.getByText("Connecting to the local runtime")).toBeTruthy();

    useHarnessConnectionStore.setState({ connectionState: "healthy" });
    runtimeQuery.isPending = false;
    runtimeQuery.data = {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "observed",
      options: {
        models: [{ id: "m-1", observedName: "Model 1", observedDescription: null }],
        controls: [],
        defaults: { modelId: null, controlValues: {} },
      },
      observedAt: "2026-08-21T11:58:00Z",
      probeAttemptedAt: "2026-08-21T11:58:00Z",
      probeFailureCode: null,
      readiness: "ready",
      canManuallyRefresh: true,
      probePhase: "idle",
    };
    rerender(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("1 model")).toBeTruthy();
    expect(screen.queryByText("Connecting to the local runtime")).toBeNull();
    expect((screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement).disabled)
      .toBe(false);
  });


  it("E-R22/E-R33: a runtime that gave up offers the restart that actually cures it", () => {
    useHarnessConnectionStore.setState({ connectionState: "failed" });
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("The local runtime didn't start")).toBeTruthy();
    expect(screen.getByText("· Retry restarts the local runtime.")).toBeTruthy();
    // The promise the old arm could not keep.
    expect(screen.queryByText("Connecting to the local runtime")).toBeNull();
    expect(screen.queryByText("· Models load as soon as it's ready.")).toBeNull();
    // The old arm told the user to relaunch the whole application. The cheap
    // cure exists and is wired: clicking Retry restarts the runtime in place.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(restartHarnessRuntime).toHaveBeenCalledTimes(1);
    expect(restartHarnessRuntime).toHaveBeenCalledWith(host.desktop?.runtime);
    // `refresh_now` still cannot reach a runtime that is not up.
    const refresh = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(refresh.querySelector(".animate-spin")).toBeNull();
  });

  it("E-R34: a host with no local runtime says so instead of connecting forever", () => {
    // Web: no desktop bridge, so nobody ever writes `connectionState` and it
    // sits at its initial "connecting" for the life of the pane.
    host.desktop = null;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("Local models aren't available here")).toBeTruthy();
    expect(screen.getByText("· The local runtime is part of the Proliferate desktop app."))
      .toBeTruthy();
    // The lie this replaces: a connection promise nothing can ever keep.
    expect(screen.queryByText("Connecting to the local runtime")).toBeNull();
    expect(screen.queryByText("· Models load as soon as it's ready.")).toBeNull();
    expect(screen.queryByText("Loading models…")).toBeNull();
    // Terminal, so no control that cannot work and nothing that spins.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    const refresh = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(refresh.querySelector(".animate-spin")).toBeNull();
  });

  it("E-R23: an offline-paused read does not spin forever", () => {
    useHarnessConnectionStore.setState({ connectionState: "healthy" });
    runtimeQuery.fetchStatus = "paused";
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText("· Models load when the connection is back.")).toBeTruthy();
    expect(screen.queryByText("Loading models…")).toBeNull();
    // The refresh mutation is parked by the same offline gate.
    expect((screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement).disabled)
      .toBe(true);
  });







  it("E-R13/E-R17: a disabled local query neither loads forever nor claims failure", () => {
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    expect(screen.getByText("Connecting to the local runtime")).toBeTruthy();
    expect(screen.queryByText("Loading models…")).toBeNull();
    expect(screen.queryByText("Models couldn't be loaded")).toBeNull();
  });
});

/**
 * The refresh control's own truth, which is a separate axis from the read's.
 *
 * A mutation has a fetch story of its own, and `isPending` collapses "the
 * request is in flight" with "query-core parked it and is waiting for the
 * network" — the same proxy-vs-fact collapse this pane exists to kill, one
 * layer over. These cases mostly have a payload, so the read has nothing left
 * to say and the control is the only thing that can lie.
 */
describe("HarnessAllModelsSection — the refresh control tells the truth (round 5)", () => {
  /** A settled observation: the read is done, so only the control can lie. */
  function observedPayload(modelCount: number): Record<string, unknown> {
    return {
      harnessKind: "claude",
      basisRevision: "b1",
      revision: 1,
      state: "observed",
      options: {
        models: Array.from({ length: modelCount }, (_unused, index) => ({
          id: `m-${index}`,
          observedName: `Model ${index}`,
          observedDescription: null,
        })),
        controls: [],
        defaults: { modelId: null, controlValues: {} },
      },
      observedAt: "2026-08-21T11:58:00Z",
      probeAttemptedAt: "2026-08-21T11:58:00Z",
      probeFailureCode: null,
      readiness: "ready",
      canManuallyRefresh: true,
      probePhase: "idle",
    };
  }

  beforeEach(() => {
    useHarnessConnectionStore.setState({ connectionState: "healthy" });
    runtimeQuery.isPending = false;
    runtimeQuery.data = observedPayload(1);
  });

  it("E-R28: a parked refresh says it is parked instead of spinning forever", () => {
    // The browser went offline after the observation settled, so the click
    // parks: query-core reports `pending` with `isPaused`, and never times out.
    refreshMutation.isPending = true;
    refreshMutation.isPaused = true;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    const refresh = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(screen.queryByRole("button", { name: "Refreshing…" })).toBeNull();
    expect(refresh.querySelector(".animate-spin")).toBeNull();
    // Nothing is in flight and a second click cannot start anything.
    expect(refresh.disabled).toBe(true);
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText("· The refresh runs when the connection is back.")).toBeTruthy();
  });

  it("E-R28: a refresh that really is in flight still spins", () => {
    refreshMutation.isPending = true;
    refreshMutation.isPaused = false;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    const refresh = screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement;
    expect(refresh.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.queryByText("You're offline")).toBeNull();
  });

  it("E-R29: a mutation outliving its runtime does not repaint a dead control", () => {
    // Clicked while healthy, then the runtime died mid-mutation.
    useHarnessConnectionStore.setState({ connectionState: "failed" });
    runtimeQuery.data = undefined;
    runtimeQuery.isPending = true;
    refreshMutation.isPending = true;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("The local runtime didn't start")).toBeTruthy();
    const refresh = screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement;
    expect(screen.queryByRole("button", { name: "Refreshing…" })).toBeNull();
    expect(refresh.querySelector(".animate-spin")).toBeNull();
    expect(refresh.disabled).toBe(true);
  });

  it("E-R31: a failed background refetch does not blank a body its header agrees with", () => {
    // The live half of the deleted override. A payload IS present, so the
    // header reads "0 models" and says nothing about the refetch; suppressing
    // "No models detected yet." underneath it would hide a true line on the
    // strength of a fact the header never mentions.
    runtimeQuery.data = observedPayload(0);
    runtimeQuery.isError = true;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    fireEvent.click(screen.getByRole("button", { name: "Models" }));

    expect(screen.getByText("0 models")).toBeTruthy();
    expect(screen.getByText("No models detected yet.")).toBeTruthy();
  });

  it("E-R14: a no-payload transport failure prints no body, from its own arm", () => {
    runtimeQuery.data = undefined;
    runtimeQuery.isPending = true;
    runtimeQuery.isError = true;
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);
    fireEvent.click(screen.getByRole("button", { name: "Models" }));

    expect(screen.getByText("Models couldn't be loaded")).toBeTruthy();
    expect(screen.queryByText("No models detected yet.")).toBeNull();
  });
});
