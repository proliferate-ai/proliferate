// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AgentInstallProgressComponent } from "@anyharness/sdk";
import { afterEach, expect, it } from "vitest";
import { HarnessUpdateProgress } from "#product/components/settings/panes/agents/harness/HarnessUpdateProgress";

afterEach(cleanup);

it("shows exact MB for owned downloads and an honest unknown npm size", () => {
  const components: AgentInstallProgressComponent[] = [
    {
      agent: "codex",
      role: "native_cli",
      phase: "downloading",
      downloadedBytes: 42_000_000,
      downloadSizeBytes: 100_000_000,
    },
    {
      agent: "codex",
      role: "agent_process",
      phase: "installing",
      downloadedBytes: 0,
      downloadSizeBytes: null,
    },
  ];

  render(
    <HarnessUpdateProgress
      components={components}
      displayName="Codex"
      targetLabel="This Mac"
    />,
  );

  expect(screen.getByText("Codex CLI")).toBeTruthy();
  expect(screen.getByText("42 MB of 100 MB")).toBeTruthy();
  expect(screen.getByText("Codex ACP adapter")).toBeTruthy();
  expect(screen.getByText("Download size unavailable")).toBeTruthy();
  expect(screen.getByRole("progressbar", {
    name: "Codex CLI download progress",
  }).getAttribute("aria-valuenow")).toBe("42");
  expect(screen.queryByRole("progressbar", {
    name: "Codex aggregate download progress",
  })).toBeNull();
});

it("labels the shared Cloud runtime without workspace terminology", () => {
  render(
    <HarnessUpdateProgress
      components={[{
        agent: "opencode",
        role: "agent_process",
        phase: "extracting",
        downloadedBytes: 20_000_000,
        downloadSizeBytes: 20_000_000,
      }]}
      displayName="OpenCode"
      targetLabel="Proliferate Cloud"
      variant="gate"
    />,
  );

  expect(screen.getByText(/Proliferate Cloud/)).toBeTruthy();
  expect(screen.getByText("20 MB of 20 MB")).toBeTruthy();
  expect(screen.queryByText("Updating OpenCode")).toBeNull();
  expect(screen.queryByText(/Workspace/)).toBeNull();
});
