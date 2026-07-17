// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
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
    workspaceId: null as string | null,
    defaultLocalSnapshot: localSnapshot,
    localSnapshot: localSnapshot as Record<string, unknown> | null,
    workspaceSnapshot: null as null | Record<string, unknown>,
  };
});

const sonnerMocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { dismiss: vi.fn() });
  return { toast };
});

vi.mock("@proliferate/ui/kit/Sonner", () => ({ toast: sonnerMocks.toast }));
vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessWorkspaceContext: () => ({ workspaceId: state.workspaceId }),
}));
vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({ isReconciling: true, reconcileSnapshot: state.localSnapshot }),
}));
vi.mock("#product/hooks/agents/derived/use-workspace-agent-catalog", () => ({
  useWorkspaceAgentCatalog: () => ({
    isReconciling: state.workspaceSnapshot !== null,
    reconcileSnapshot: state.workspaceSnapshot,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.workspaceId = null;
  state.localSnapshot = state.defaultLocalSnapshot;
  state.workspaceSnapshot = null;
});

it("dismisses workspace progress when its route-scoped target disappears", () => {
  state.workspaceId = "workspace-1";
  state.localSnapshot = null;
  state.workspaceSnapshot = {
    jobId: "job-workspace",
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
  const { rerender } = render(<HarnessUpdateToastPresenter />);
  expect(sonnerMocks.toast).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: "harness-update:workspace:workspace-1" }),
  );

  state.workspaceId = null;
  state.workspaceSnapshot = null;
  rerender(<HarnessUpdateToastPresenter />);

  expect(sonnerMocks.toast.dismiss).toHaveBeenCalledWith(
    "harness-update:workspace:workspace-1",
  );
});

it("shows local aggregate MB and the current harness", () => {
  render(<HarnessUpdateToastPresenter />);

  const [title, options] = sonnerMocks.toast.mock.calls[0] ?? [];
  render(<>{title}{options.description}</>);

  expect(screen.getByText("AGENTS")).toBeTruthy();
  expect(screen.getByText("Updating Codex")).toBeTruthy();
  expect(screen.getByText(/Local runtime · 42 MB of 100 MB/)).toBeTruthy();
  expect(options.id).toBe(HARNESS_UPDATE_TOAST_ID);
  expect(screen.getByRole("progressbar", {
    name: "Local runtime agent tools download progress",
  }).getAttribute("aria-valuenow")).toBe("42");
});
