// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

/**
 * The three ways a launch-options payload can be absent, kept apart.
 *
 * `HarnessAllModelsSection.test.tsx` owns the (state x probePhase) matrix,
 * which by definition has a payload. These cases have none, and the whole
 * point of the pane is that "no payload" is not one condition: a request in
 * flight, a query nobody enabled, and a request that failed are three
 * different truths and must render as three different things.
 *
 * The fakes mirror TanStack v5 exactly: a DISABLED query reports
 * `isPending: true` with `fetchStatus: "idle"`, which is what makes
 * `isPending` alone unusable as an "in flight" signal.
 */

const runtimeQuery = vi.hoisted(() => ({
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
  isError: false,
  isPending: true,
  fetchStatus: "idle" as "idle" | "fetching",
  refetch: vi.fn(),
}));

const cloudState = vi.hoisted(() => ({
  // 200-with-a-null-body: the account simply has no cloud workspace.
  sandbox: null as Record<string, unknown> | null,
  launchOptions: undefined as Record<string, unknown> | undefined,
  launchOptionsError: null as Error | null,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => runtimeQuery,
  useRefreshHarnessLaunchOptionsMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudSandbox: () => ({
    data: cloudState.sandbox,
    isLoading: false,
    isError: false,
    isPending: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
  // The real hook is disabled without a non-empty target, so a null sandbox
  // leaves it pending-and-idle forever.
  useCloudHarnessLaunchOptions: ({ cloudSandboxId }: { cloudSandboxId?: string | null }) => {
    const error = cloudSandboxId ? cloudState.launchOptionsError : null;
    const data = cloudSandboxId && !error ? cloudState.launchOptions : undefined;
    return {
      data,
      error,
      isLoading: false,
      isError: error !== null,
      isPending: data === undefined && error === null,
      fetchStatus: "idle",
      refetch: vi.fn(),
    };
  },
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: true }),
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
  runtimeQuery.isLoading = false;
  runtimeQuery.isError = false;
  runtimeQuery.isPending = true;
  runtimeQuery.fetchStatus = "idle";
  runtimeQuery.refetch.mockReset();
  cloudState.sandbox = null;
  cloudState.launchOptions = undefined;
  cloudState.launchOptionsError = null;
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
      probePhase: "idle",
    };
    rerender(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("1 model")).toBeTruthy();
    expect(screen.queryByText("Connecting to the local runtime")).toBeNull();
    expect((screen.getByRole("button", { name: /^refresh$/i }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("E-R18: a cloud account with no workspace never shows a permanent spinner", () => {
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="cloud" />);

    expect(screen.getByText("No cloud workspace yet")).toBeTruthy();
    expect(screen.getByText("· Claude models are listed once a cloud workspace exists."))
      .toBeTruthy();
    // The bug this replaces: a forever "Loading models…" with no Refresh and
    // no Retry anywhere in the view.
    expect(screen.queryByText("Loading models…")).toBeNull();
    expect(screen.queryByText("Models couldn't be loaded")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^refresh$/i })).toBeNull();
  });

  it("E-R22: a runtime that gave up is not reported as still connecting", () => {
    useHarnessConnectionStore.setState({ connectionState: "failed" });
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />);

    expect(screen.getByText("The local runtime didn't start")).toBeTruthy();
    expect(screen.getByText("· Restart Proliferate to try again.")).toBeTruthy();
    // The promise the old arm could not keep.
    expect(screen.queryByText("Connecting to the local runtime")).toBeNull();
    expect(screen.queryByText("· Models load as soon as it's ready.")).toBeNull();
    // No control that cannot work, but the line still names a real cure.
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

  it("E-R24: a not-observed 404 is the cloud first-run screen, not a failure", () => {
    cloudState.sandbox = { id: "sandbox-1" };
    cloudState.launchOptionsError = new ProliferateClientError(
      "Harness launch options have not been observed on this target.",
      404,
      "harness_launch_options_not_observed",
    );
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="cloud" />);

    expect(screen.getByText("Models haven't been detected yet")).toBeTruthy();
    expect(screen.getByText("· Claude reports models after its first run in this workspace."))
      .toBeTruthy();
    // The server DID respond, with a structured code.
    expect(screen.queryByText("Models couldn't be loaded")).toBeNull();
    expect(screen.queryByText("· The runtime didn't respond.")).toBeNull();
    // Retrying re-issues the same GET and 404s forever.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("E-R24: an unstructured cloud failure still gets the error arm and a Retry", () => {
    cloudState.sandbox = { id: "sandbox-1" };
    cloudState.launchOptionsError = new ProliferateClientError("Bad Gateway", 502, null);
    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="cloud" />);

    expect(screen.getByText("Models couldn't be loaded")).toBeTruthy();
    expect(screen.getByText("· Proliferate Cloud didn't respond.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("E-R19: neither new arm prints a body that contradicts its own header", () => {
    const { unmount } = render(
      <HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="local" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.getByText("Connecting to the local runtime")).toBeTruthy();
    expect(screen.queryByText("No models detected yet.")).toBeNull();
    unmount();

    render(<HarnessAllModelsSection harnessKind="claude" displayName="Claude" surface="cloud" />);
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.getByText("No cloud workspace yet")).toBeTruthy();
    expect(screen.queryByText("No models detected yet.")).toBeNull();
  });
});
