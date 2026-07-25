// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { AgentSummary } from "@anyharness/sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { useHarnessInstallAction } from "./use-harness-install-action";

const installAgent = vi.hoisted(() => vi.fn());
const refreshAgentResources = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const installationState = vi.hoisted(() => ({
  isAgentSeedHydrating: false,
  isInstallingAgent: false,
}));

vi.mock("@/hooks/agents/workflows/use-agent-installation-actions", () => ({
  useAgentInstallationActions: () => ({
    installAgent,
    isAgentSeedHydrating: installationState.isAgentSeedHydrating,
    isInstallingAgent: installationState.isInstallingAgent,
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
  installationState.isAgentSeedHydrating = false;
  installationState.isInstallingAgent = false;
});

it("force-installs a missing managed harness from its settings action", async () => {
  const { result } = renderHook(() => useHarnessInstallAction(agent));

  await act(async () => {
    expect(result.current?.kind).toBe("action");
    if (result.current?.kind === "action") {
      result.current.onInstall();
    }
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

it("uses honest global progress without claiming a non-seeded harness is installing", () => {
  installationState.isAgentSeedHydrating = true;
  const nonSeededAgent = {
    ...agent,
    kind: "opencode",
    displayName: "OpenCode",
  } as AgentSummary;

  const { result } = renderHook(() => useHarnessInstallAction(nonSeededAgent));

  expect(result.current).toEqual({
    kind: "progress",
    label: "Finishing local agent setup...",
    detail:
      "Proliferate is preparing bundled agent tools; install options return when setup finishes.",
  });
  expect(result.current?.label).not.toContain("OpenCode");
});

it("shows automatic update progress for an agent queued by reconcile", () => {
  installationState.isAgentSeedHydrating = true;
  const reconcilingAgent = {
    ...agent,
    installState: "installing",
  } as AgentSummary;

  const { result } = renderHook(() => useHarnessInstallAction(reconcilingAgent));

  expect(result.current).toEqual({
    kind: "progress",
    label: "Updating Codex...",
    detail: "Proliferate is updating Codex automatically.",
  });
});
