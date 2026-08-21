// @vitest-environment jsdom

// Ack-gated onboarding "setting up" step (agent-auth.md, Proof C7 — the hook
// half; the release-scenario half is a later live-validation pass): the step
// resolves on applied, auto-advances at grace expiry, and never blocks (or
// errors) on enrollment failure.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthSetupOnboardingStep } from "#product/hooks/agents/lifecycle/use-auth-setup-onboarding-step";
import { AUTH_SETUP_GRACE_MS } from "#product/lib/domain/agents/auth-onboarding";
import { useAuthSetupOnboardingStore } from "#product/stores/agents/auth-setup-onboarding-store";

const state = vi.hoisted(() => ({
  // Cloud COMPUTE is off for this entire suite, deliberately: that is the
  // shipped production posture, and this step watches control-plane state
  // (auth selections + gateway enrollment) that must resolve regardless.
  // Re-couple the hook to `cloudActive` and the whole file fails.
  cloudActive: false,
  authStatus: "authenticated" as "authenticated" | "anonymous" | "loading",
  controlPlaneReachable: true,
  selections: {
    data: undefined as Array<Record<string, unknown>> | undefined,
  },
  enrollment: {
    data: undefined as { syncStatus: string } | undefined,
    isError: false,
  },
  selectionsArgs: [] as Array<{ surface: unknown; enabled: unknown; options: unknown }>,
  enrollmentArgs: [] as Array<{ enabled: unknown; options: unknown }>,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAuthSelections: (surface: unknown, enabled: unknown, options: unknown) => {
    state.selectionsArgs.push({ surface, enabled, options });
    return state.selections;
  },
  useAgentGatewayEnrollment: (enabled: unknown, options: unknown) => {
    state.enrollmentArgs.push({ enabled, options });
    return state.enrollment;
  },
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudActive: state.cloudActive,
    authStatus: state.authStatus,
    controlPlaneReachable: state.controlPlaneReachable,
  }),
}));

function recordAdoption(harnessKinds: string[]) {
  act(() => {
    useAuthSetupOnboardingStore
      .getState()
      .recordAdoption(harnessKinds, Date.now());
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  useAuthSetupOnboardingStore.getState().resetForTests();
  state.cloudActive = false;
  state.authStatus = "authenticated";
  state.controlPlaneReachable = true;
  state.selections.data = undefined;
  state.enrollment.data = undefined;
  state.enrollment.isError = false;
  state.selectionsArgs = [];
  state.enrollmentArgs = [];
});

describe("useAuthSetupOnboardingStep", () => {
  it("stays hidden before adoption has decided, and when it adopted nothing", () => {
    const { result, rerender } = renderHook(() => useAuthSetupOnboardingStep());
    expect(result.current).toBe("hidden");

    recordAdoption([]);
    rerender();
    expect(result.current).toBe("hidden");
  });

  it("shows setting-up while the adopted selections await their ack", () => {
    recordAdoption(["claude"]);
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: false },
    ];
    state.enrollment.data = { syncStatus: "synced" };

    const { result } = renderHook(() => useAuthSetupOnboardingStep());
    expect(result.current).toBe("settingUp");
  });

  it("polls the selections and enrollment through the refetchInterval seam while watching", () => {
    recordAdoption(["claude"]);
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: false },
    ];
    state.enrollment.data = { syncStatus: "synced" };

    renderHook(() => useAuthSetupOnboardingStep());

    const lastSelections = state.selectionsArgs[state.selectionsArgs.length - 1];
    expect(lastSelections).toMatchObject({
      surface: "local",
      enabled: true,
      options: { refetchInterval: 3000 },
    });
    expect(state.enrollmentArgs[state.enrollmentArgs.length - 1]).toMatchObject({
      enabled: true,
      options: { refetchInterval: 3000 },
    });
  });

  it("resolves on applied and latches — a later pending edit never resurrects it", () => {
    recordAdoption(["claude", "codex"]);
    state.enrollment.data = { syncStatus: "synced" };
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: false },
      { harnessKind: "codex", surface: "local", applied: true },
    ];

    const { result, rerender } = renderHook(() => useAuthSetupOnboardingStep());
    expect(result.current).toBe("settingUp");

    // The ack lands (the poll observes applied on every adopted selection).
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: true },
      { harnessKind: "codex", surface: "local", applied: true },
    ];
    rerender();
    expect(result.current).toBe("applied");

    // Latched: a later manual edit going pending is the panes' business.
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: false },
    ];
    rerender();
    expect(result.current).toBe("applied");
    // Watching ended: the polls are off.
    expect(state.selectionsArgs[state.selectionsArgs.length - 1]).toMatchObject({
      enabled: false,
      options: { refetchInterval: false },
    });
  });

  it("treats an unsynced enrollment (keys not minted) as the same pending state", () => {
    recordAdoption(["claude"]);
    state.enrollment.data = { syncStatus: "pending" };
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: true },
    ];

    const { result, rerender } = renderHook(() => useAuthSetupOnboardingStep());
    expect(result.current).toBe("settingUp");

    state.enrollment.data = { syncStatus: "synced" };
    rerender();
    expect(result.current).toBe("applied");
  });

  it("auto-advances at grace expiry instead of blocking onboarding", () => {
    recordAdoption(["claude"]);
    state.enrollment.data = { syncStatus: "synced" };
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: false },
    ];

    const { result } = renderHook(() => useAuthSetupOnboardingStep());
    expect(result.current).toBe("settingUp");

    act(() => {
      vi.advanceTimersByTime(AUTH_SETUP_GRACE_MS + 1);
    });
    expect(result.current).toBe("advanced");
  });

  it("stays advanced (never resurrects) when the ack lands after the grace", () => {
    recordAdoption(["claude"]);
    state.enrollment.data = { syncStatus: "synced" };
    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: false },
    ];

    const { result, rerender } = renderHook(() => useAuthSetupOnboardingStep());
    act(() => {
      vi.advanceTimersByTime(AUTH_SETUP_GRACE_MS + 1);
    });
    expect(result.current).toBe("advanced");

    state.selections.data = [
      { harnessKind: "claude", surface: "local", applied: true },
    ];
    rerender();
    expect(result.current).toBe("advanced");
  });

  it("never blocks on enrollment failure: pending, then the grace advances", () => {
    recordAdoption(["claude"]);
    state.enrollment.data = undefined;
    state.enrollment.isError = true;
    state.selections.data = undefined;

    const { result } = renderHook(() => useAuthSetupOnboardingStep());
    // Provisioning trouble is the ordinary pending state, never an error.
    expect(result.current).toBe("settingUp");

    act(() => {
      vi.advanceTimersByTime(AUTH_SETUP_GRACE_MS + 1);
    });
    expect(result.current).toBe("advanced");
  });

  it("watches with cloud compute disabled, and stops watching when signed out", () => {
    // Launch posture: cloud compute off, signed in, control plane reachable.
    // The step must still enable both watch queries.
    recordAdoption(["claude"]);
    const { rerender } = renderHook(() => useAuthSetupOnboardingStep());
    expect(state.selectionsArgs.at(-1)?.enabled).toBe(true);
    expect(state.enrollmentArgs.at(-1)?.enabled).toBe(true);

    state.authStatus = "anonymous";
    rerender();
    expect(state.selectionsArgs.at(-1)?.enabled).toBe(false);
    expect(state.enrollmentArgs.at(-1)?.enabled).toBe(false);

    state.authStatus = "authenticated";
    state.controlPlaneReachable = false;
    rerender();
    expect(state.selectionsArgs.at(-1)?.enabled).toBe(false);
    expect(state.enrollmentArgs.at(-1)?.enabled).toBe(false);
  });

  it("advances immediately when the app observes an already-expired grace window", () => {
    act(() => {
      useAuthSetupOnboardingStore
        .getState()
        .recordAdoption(["claude"], Date.now() - AUTH_SETUP_GRACE_MS - 1);
    });
    state.enrollment.data = { syncStatus: "pending" };

    const { result } = renderHook(() => useAuthSetupOnboardingStep());
    expect(result.current).toBe("advanced");
  });
});
