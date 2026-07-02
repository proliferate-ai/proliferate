// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputeTargetAgentAuthCard } from "./ComputeTargetAgentAuthCard";

const state = vi.hoisted(() => ({
  overrides: {
    data: { selections: [] as Array<Record<string, unknown>> } as
      | { selections: Array<Record<string, unknown>> }
      | undefined,
  },
  attachState: "attached" as string,
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRouteSelections: (_enabled?: boolean, _options?: { targetId?: string | null }) =>
    state.overrides,
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: true }),
}));

vi.mock("@/hooks/compute/derived/use-direct-runtime-attach-states", () => ({
  useDirectRuntimeAttachState: () => state.attachState,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.overrides.data = { selections: [] };
  state.attachState = "attached";
});

describe("ComputeTargetAgentAuthCard", () => {
  it("summarizes a zero-override runtime as using the defaults", () => {
    render(<ComputeTargetAgentAuthCard targetId="t-1" />);

    expect(screen.queryByText("Using your defaults")).not.toBeNull();
    expect(screen.queryByText(/overrides?$/)).toBeNull();
  });

  it("counts per-runtime overrides", () => {
    state.overrides.data = {
      selections: [
        { id: "o-1", harnessKind: "claude" },
        { id: "o-2", harnessKind: "codex" },
      ],
    };
    render(<ComputeTargetAgentAuthCard targetId="t-1" />);

    expect(screen.queryByText("2 overrides")).not.toBeNull();
  });

  it("notes deferred application while the runtime is not attached", () => {
    state.attachState = "unreachable";
    render(<ComputeTargetAgentAuthCard targetId="t-1" />);

    expect(
      screen.queryByText(/apply the next time it attaches/),
    ).not.toBeNull();
    // Still editable: the manage affordance stays enabled.
    const manage = screen.getByRole("button", { name: "Manage agent auth" });
    expect((manage as HTMLButtonElement).disabled).toBe(false);
  });

  it("links into the agents scope for this runtime", () => {
    render(<ComputeTargetAgentAuthCard targetId="t-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Manage agent auth" }));

    expect(navigateMock).toHaveBeenCalledWith(
      "/settings?section=agent-claude&target=t-1",
    );
  });
});
