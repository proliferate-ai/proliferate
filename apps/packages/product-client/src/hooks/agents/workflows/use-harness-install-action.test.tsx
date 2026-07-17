// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { AgentSummary } from "@anyharness/sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { useHarnessInstallAction } from "#product/hooks/agents/workflows/use-harness-install-action";

const reconcileAgents = vi.hoisted(() => vi.fn());
const installAgent = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const actionState = vi.hoisted(() => ({ supportsScopedReconcile: true }));

vi.mock("#product/hooks/agents/workflows/use-agent-installation-actions", () => ({
  useAgentInstallationActions: () => ({
    installAgent,
    isInstallingAgent: false,
    reconcileAgents,
    reconcileSnapshot: null,
    isAgentSeedHydrating: false,
    isReconcilingAgents: false,
    supportsScopedReconcile: actionState.supportsScopedReconcile,
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

const agent = {
  kind: "codex",
  displayName: "Codex",
  installState: "install_required",
  readiness: "install_required",
} as AgentSummary;

beforeEach(() => {
  vi.clearAllMocks();
  actionState.supportsScopedReconcile = true;
  installAgent.mockResolvedValue({});
  reconcileAgents.mockResolvedValue({});
});

it("force-installs a missing managed harness from its settings action", async () => {
  const { result } = renderHook(() => useHarnessInstallAction(agent));

  await act(async () => {
    result.current?.onInstall();
    await vi.waitFor(() => expect(reconcileAgents).toHaveBeenCalledOnce());
  });

  expect(reconcileAgents).toHaveBeenCalledWith({
    reinstall: true,
    agentKinds: ["codex"],
  });
  expect(showToast).toHaveBeenCalledWith("Updating Codex on the local runtime.");
});

it("uses the kind-scoped install endpoint for an older runtime", async () => {
  actionState.supportsScopedReconcile = false;
  const { result } = renderHook(() => useHarnessInstallAction(agent));

  await act(async () => {
    result.current?.onInstall();
    await vi.waitFor(() => expect(installAgent).toHaveBeenCalledOnce());
  });

  expect(installAgent).toHaveBeenCalledWith("codex", { reinstall: true });
  expect(reconcileAgents).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith("Codex is ready.");
});

it("does not offer installation for an already installed harness", () => {
  const readyAgent = {
    ...agent,
    installState: "installed",
    readiness: "ready",
  } as AgentSummary;
  const { result } = renderHook(() => useHarnessInstallAction(readyAgent));

  expect(result.current).toBeNull();
});
