// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  CLOUD_HARNESS_UPDATE_TOAST_ID,
  HarnessUpdateToastPresenter,
  HARNESS_UPDATE_TOAST_ID,
} from "#product/components/feedback/HarnessUpdateToastPresenter";

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

const sonnerMocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { custom: vi.fn(), dismiss: vi.fn() });
  return { toast };
});

vi.mock("@proliferate/ui/kit/Sonner", () => ({ toast: sonnerMocks.toast }));
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = false;
  state.catalogCallCount = 0;
  state.localSnapshot = state.defaultLocalSnapshot;
  state.cloudSnapshot = null;
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

  await waitFor(() => expect(sonnerMocks.toast.custom.mock.calls.some(
    ([, options]) => options.id === CLOUD_HARNESS_UPDATE_TOAST_ID,
  )).toBe(true));
  const cloudCall = sonnerMocks.toast.custom.mock.calls.find(
    ([, options]) => options.id === CLOUD_HARNESS_UPDATE_TOAST_ID,
  );
  expect(cloudCall).toBeTruthy();
  const [renderToast] = cloudCall ?? [];
  render(<>{renderToast(CLOUD_HARNESS_UPDATE_TOAST_ID)}</>);
  expect(screen.getByText(/Proliferate Cloud · 12 MB downloaded/)).toBeTruthy();
  expect(screen.queryByText(/workspace/i)).toBeNull();
});

it("shows local aggregate MB and the current harness", () => {
  render(<HarnessUpdateToastPresenter />);

  const [renderToast, options] = sonnerMocks.toast.custom.mock.calls[0] ?? [];
  render(<>{renderToast(HARNESS_UPDATE_TOAST_ID)}</>);

  expect(screen.getByText("Updating Codex")).toBeTruthy();
  expect(screen.getByText(/This machine · 42 MB of 100 MB/)).toBeTruthy();
  expect(options.id).toBe(HARNESS_UPDATE_TOAST_ID);
  expect(options.unstyled).toBe(true);
  expect(screen.getByRole("progressbar", {
    name: "This machine agent tools download progress",
  }).getAttribute("aria-valuenow")).toBe("42");

  fireEvent.click(screen.getByRole("button", { name: "Dismiss agent update" }));
  expect(sonnerMocks.toast.dismiss).toHaveBeenCalledWith(HARNESS_UPDATE_TOAST_ID);
});

it("can keep deterministic playground progress local-only", async () => {
  state.cloudActive = true;
  render(<HarnessUpdateToastPresenter includeCloud={false} />);

  await waitFor(() => expect(sonnerMocks.toast.custom).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: HARNESS_UPDATE_TOAST_ID }),
  ));
  expect(sonnerMocks.toast.custom).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: CLOUD_HARNESS_UPDATE_TOAST_ID }),
  );
});

it("keeps a dismissed active job hidden until a different job starts", () => {
  const { rerender } = render(<HarnessUpdateToastPresenter />);
  const [, options] = sonnerMocks.toast.custom.mock.calls[0] ?? [];
  expect(options.onDismiss).toBeTypeOf("function");

  options.onDismiss({ id: HARNESS_UPDATE_TOAST_ID });
  vi.clearAllMocks();
  state.localSnapshot = {
    ...state.defaultLocalSnapshot,
    progress: {
      ...(state.defaultLocalSnapshot.progress as Record<string, unknown>),
      downloadedBytes: 55_000_000,
    },
  };
  rerender(<HarnessUpdateToastPresenter />);
  expect(sonnerMocks.toast.custom).not.toHaveBeenCalled();

  state.localSnapshot = {
    ...state.localSnapshot,
    status: "completed",
  };
  rerender(<HarnessUpdateToastPresenter />);
  expect(sonnerMocks.toast.custom).not.toHaveBeenCalled();

  state.localSnapshot = {
    ...state.defaultLocalSnapshot,
    jobId: "job-local-2",
  };
  rerender(<HarnessUpdateToastPresenter />);
  expect(sonnerMocks.toast.custom).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: HARNESS_UPDATE_TOAST_ID }),
  );
});
