// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AGENT_ROUTE_STATE_LINEAGE,
  LocalAuthLineageResetBanner,
} from "#product/components/settings/panes/agents/harness/LocalAuthLineageResetBanner";
import { useLocalAuthDeliveryStore } from "#product/stores/agents/local-auth-delivery-store";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

const mocks = vi.hoisted(() => ({
  clearAgentAuthState: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/agent-auth", () => ({
  clearAgentAuthState: mocks.clearAgentAuthState,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  agentAuthStateRootKey: () => ["agent-auth-state"],
}));

// The runtime's own Display copy, as the courier would have recorded it from
// the 409's problem detail.
const REFUSAL_WORDS =
  "this machine holds agent-auth state from a different server database. "
  + "If the server was rebuilt or switched on purpose, reset this machine's "
  + "agent auth (Settings → Agents) and it will adopt the new one.";

beforeEach(() => {
  mocks.clearAgentAuthState.mockResolvedValue(undefined);
  mocks.invalidateQueries.mockResolvedValue(undefined);
  useHarnessConnectionStore.getState().setRuntimeUrl("http://127.0.0.1:7777");
  useLocalAuthDeliveryStore.getState().clearLastPushFailure();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders nothing without a lineage refusal on record", () => {
  const { container } = render(<LocalAuthLineageResetBanner />);
  expect(container.firstChild).toBeNull();

  // A non-lineage push failure (a flaky network, a stale sequence) is not
  // this banner's business either.
  useLocalAuthDeliveryStore.getState().setLastPushFailure({
    code: "AGENT_ROUTE_STATE_STALE",
    detail: "stale push",
  });
  const { container: second } = render(<LocalAuthLineageResetBanner />);
  expect(second.firstChild).toBeNull();
});

it("shows the runtime's refusal words verbatim on the lineage code", () => {
  useLocalAuthDeliveryStore.getState().setLastPushFailure({
    code: AGENT_ROUTE_STATE_LINEAGE,
    detail: REFUSAL_WORDS,
  });

  render(<LocalAuthLineageResetBanner />);

  expect(screen.getByText(REFUSAL_WORDS)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Reset this machine's agent auth" }),
  ).toBeTruthy();
});

it("resets by clearing the runtime state and re-triggering the sync", async () => {
  useLocalAuthDeliveryStore.getState().setLastPushFailure({
    code: AGENT_ROUTE_STATE_LINEAGE,
    detail: REFUSAL_WORDS,
  });

  render(<LocalAuthLineageResetBanner />);
  fireEvent.click(
    screen.getByRole("button", { name: "Reset this machine's agent auth" }),
  );

  // The EXISTING reset door (DELETE /v1/agent-auth/state), against the same
  // local runtime the courier pushes to.
  await waitFor(() => {
    expect(mocks.clearAgentAuthState).toHaveBeenCalledWith({
      runtimeUrl: "http://127.0.0.1:7777",
    });
  });
  // The re-trigger: invalidating the auth-state query re-runs the courier's
  // push effect, and with no persisted document the push adopts.
  await waitFor(() => {
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["agent-auth-state"],
    });
  });
  // The recorded refusal is resolved, so the banner leaves.
  await waitFor(() => {
    expect(useLocalAuthDeliveryStore.getState().lastPushFailure).toBeNull();
  });
});
