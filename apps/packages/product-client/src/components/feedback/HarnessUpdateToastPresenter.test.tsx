// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ToastInput } from "@proliferate/ui/utils/toast-model";
import {
  CLOUD_HARNESS_UPDATE_TOAST_ID,
  HarnessUpdateToastPresenter,
  HARNESS_UPDATE_TOAST_ID,
} from "#product/components/feedback/HarnessUpdateToastPresenter";

/**
 * The harness flow used to maintain its own toast card — its own frame, close
 * button and progress bar. It now raises kit weights like everything else, so
 * these tests assert the *input* it hands the kit: which weight, which copy,
 * which id. The frame is the kit's, and is tested there.
 */

const state = vi.hoisted(() => {
  const localSnapshot = {
    jobId: "job-local",
    status: "running",
    currentAgent: "codex",
    progress: {
      downloadedBytes: 42_000_000,
      downloadSizeBytes: 100_000_000,
      completedComponents: 0,
      totalComponents: 1,
      components: [{
        agent: "codex",
        role: "native_cli",
        phase: "downloading",
        downloadedBytes: 42_000_000,
        downloadSizeBytes: 100_000_000,
      }],
    },
  } as Record<string, unknown>;
  return {
    cloudActive: false,
    catalogCallCount: 0,
    defaultLocalSnapshot: localSnapshot,
    localSnapshot: localSnapshot as Record<string, unknown> | null,
    cloudSnapshot: null as null | Record<string, unknown>,
  };
});

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn((_input: unknown) => "toast-id"),
  dismissToast: vi.fn(),
}));

vi.mock("@proliferate/ui/utils/show-toast", () => toastMocks);
vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => {
    state.catalogCallCount += 1;
    const cloudCall = state.cloudActive && state.catalogCallCount % 2 === 0;
    return {
      isReconciling: true,
      reconcileSnapshot: cloudCall ? state.cloudSnapshot : state.localSnapshot,
    };
  },
}));
vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));
vi.mock("#product/providers/CloudAnyHarnessRuntimeProvider", () => ({
  CloudAnyHarnessRuntimeProvider: ({ children }: { children: ReactNode }) => children,
}));

function raisedWithId(id: string): ToastInput | undefined {
  return toastMocks.showToast.mock.calls
    .map(([input]) => input as ToastInput)
    .find((input) => input.id === id);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = false;
  state.catalogCallCount = 0;
  state.localSnapshot = state.defaultLocalSnapshot;
  state.cloudSnapshot = null;
});

it("reports local progress as one status line with a mono byte suffix", () => {
  render(<HarnessUpdateToastPresenter />);

  const toastInput = raisedWithId(HARNESS_UPDATE_TOAST_ID);
  expect(toastInput).toMatchObject({
    message: "Updating Codex · This machine",
    code: "42 MB of 100 MB",
    // A download with no announced end has no dwell to promise; the terminal
    // branch replaces this toast when the job resolves.
    duration: Number.POSITIVE_INFINITY,
  });
  // status is the default weight, so the flow states no weight at all.
  expect(toastInput).not.toHaveProperty("weight");
});

it("shows shared Cloud progress without a workspace target", async () => {
  state.cloudActive = true;
  state.localSnapshot = null;
  state.cloudSnapshot = {
    jobId: "job-cloud",
    status: "running",
    currentAgent: "claude",
    progress: {
      downloadedBytes: 12_000_000,
      downloadSizeBytes: null,
      completedComponents: 0,
      totalComponents: 1,
      components: [{
        agent: "claude",
        role: "agent_process",
        phase: "installing",
        downloadedBytes: 12_000_000,
        downloadSizeBytes: null,
      }],
    },
  };
  render(<HarnessUpdateToastPresenter />);

  await waitFor(() => {
    expect(raisedWithId(CLOUD_HARNESS_UPDATE_TOAST_ID)).toBeTruthy();
  });
  const toastInput = raisedWithId(CLOUD_HARNESS_UPDATE_TOAST_ID) as {
    message: string;
    code: string;
  };
  expect(toastInput.message).toBe("Updating Claude Code · Proliferate Cloud");
  expect(toastInput.code).toBe("12 MB downloaded");
  expect(toastInput.message).not.toMatch(/workspace/i);
});

it("can keep deterministic playground progress local-only", async () => {
  state.cloudActive = true;
  render(<HarnessUpdateToastPresenter includeCloud={false} />);

  await waitFor(() => {
    expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toBeTruthy();
  });
  expect(raisedWithId(CLOUD_HARNESS_UPDATE_TOAST_ID)).toBeUndefined();
});

it("closes with a one-line receipt when the job succeeds", () => {
  const { rerender } = render(<HarnessUpdateToastPresenter />);
  vi.clearAllMocks();

  state.localSnapshot = { ...state.defaultLocalSnapshot, status: "completed" };
  rerender(<HarnessUpdateToastPresenter />);

  expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
    message: "Agent tools updated · This machine",
    tone: "success",
  });
});

it("states what still works when the job fails", () => {
  const { rerender } = render(<HarnessUpdateToastPresenter />);
  vi.clearAllMocks();

  state.localSnapshot = { ...state.defaultLocalSnapshot, status: "failed" };
  rerender(<HarnessUpdateToastPresenter />);

  expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toMatchObject({
    weight: "announcement",
    tone: "warning",
    title: "Some agent tools could not update",
    description:
      "This machine: the ones that updated are usable. Open agent settings to retry the rest.",
  });
});

it("keeps a dismissed active job hidden until a different job starts", () => {
  const { rerender } = render(<HarnessUpdateToastPresenter />);
  const toastInput = toastMocks.showToast.mock.calls[0]?.[0] as unknown as {
    onDismiss: () => void;
  };
  expect(toastInput.onDismiss).toBeTypeOf("function");

  toastInput.onDismiss();
  vi.clearAllMocks();
  state.localSnapshot = {
    ...state.defaultLocalSnapshot,
    progress: {
      ...(state.defaultLocalSnapshot.progress as Record<string, unknown>),
      downloadedBytes: 55_000_000,
    },
  };
  rerender(<HarnessUpdateToastPresenter />);
  expect(toastMocks.showToast).not.toHaveBeenCalled();

  state.localSnapshot = { ...state.localSnapshot, status: "completed" };
  rerender(<HarnessUpdateToastPresenter />);
  expect(toastMocks.showToast).not.toHaveBeenCalled();

  state.localSnapshot = { ...state.defaultLocalSnapshot, jobId: "job-local-2" };
  rerender(<HarnessUpdateToastPresenter />);
  expect(raisedWithId(HARNESS_UPDATE_TOAST_ID)).toBeTruthy();
});
