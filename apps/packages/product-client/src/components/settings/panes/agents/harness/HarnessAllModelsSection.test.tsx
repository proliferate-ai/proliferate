// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";

const state = vi.hoisted(() => ({
  launchOptions: undefined as Record<string, unknown> | undefined,
  refresh: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => ({
    data: state.launchOptions,
    isLoading: false,
  }),
  useRefreshHarnessLaunchOptionsMutation: () => ({
    mutate: state.refresh,
    isPending: false,
  }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudSandbox: () => ({ data: null, isLoading: false }),
  useCloudHarnessLaunchOptions: () => ({ data: undefined, isLoading: false }),
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
  state.refresh.mockReset();
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
    readiness: "ready",
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
