// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AgentSummary } from "@anyharness/sdk";
import { afterEach, expect, it } from "vitest";
import { HarnessConfigIssueBanner } from "#product/components/settings/panes/agents/harness/HarnessConfigIssueBanner";

const agent = {
  kind: "codex",
  displayName: "Codex",
  installState: "installed",
  readiness: "login_required",
  message: "Sign in to continue.",
} as AgentSummary;

afterEach(cleanup);

it("keeps post-install configuration warnings actionless", () => {
  render(<HarnessConfigIssueBanner agent={agent} />);

  expect(screen.getByText("Login required")).toBeTruthy();
  expect(screen.getByText("Sign in with Codex in Proliferate.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
