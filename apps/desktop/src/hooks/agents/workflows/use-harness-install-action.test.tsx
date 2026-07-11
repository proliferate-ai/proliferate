// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { AgentSummary } from "@anyharness/sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { useHarnessInstallAction } from "./use-harness-install-action";

const installAgent = vi.hoisted(() => vi.fn());
const refreshAgentResources = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/agents/workflows/use-agent-installation-actions", () => ({
  useAgentInstallationActions: () => ({
    installAgent,
    isAgentSeedHydrating: false,
    isInstallingAgent: false,
    refreshAgentResources,
  }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
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
  installAgent.mockResolvedValue({});
  refreshAgentResources.mockResolvedValue(undefined);
});

it("force-installs a missing managed harness from its settings action", async () => {
  const { result } = renderHook(() => useHarnessInstallAction(agent));

  await act(async () => {
    result.current?.onInstall();
    await vi.waitFor(() => expect(refreshAgentResources).toHaveBeenCalledOnce());
  });

  expect(installAgent).toHaveBeenCalledWith("codex", { reinstall: true });
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
