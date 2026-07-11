// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentSummary } from "@anyharness/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { HarnessConfigIssueBanner } from "./HarnessConfigIssueBanner";

const agent = {
  kind: "codex",
  displayName: "Codex",
  installState: "install_required",
  readiness: "install_required",
  message: "Not installed. Use the install endpoint to set up.",
} as AgentSummary;

afterEach(cleanup);

it("renders the managed install action beside an install-required warning", () => {
  const onInstall = vi.fn();
  render(
    <HarnessConfigIssueBanner
      agent={agent}
      installAction={{
        label: "Install",
        loading: false,
        disabled: false,
        onInstall,
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Install" }));

  expect(onInstall).toHaveBeenCalledOnce();
  expect(screen.getByText("Install required")).toBeTruthy();
  expect(screen.getByText("Install this managed harness to use it in this profile.")).toBeTruthy();
});

it("keeps non-install configuration warnings actionless", () => {
  render(<HarnessConfigIssueBanner agent={agent} />);

  expect(screen.queryByRole("button")).toBeNull();
});
