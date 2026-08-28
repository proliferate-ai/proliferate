// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessNativeBridgePrompt } from "#product/components/settings/panes/agents/harness/HarnessNativeBridgePrompt";

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessCacheScopeKey: () => "test-scope",
}));

const accessMocks = vi.hoisted(() => ({
  getNativeBridge: vi.fn(),
  dismissNativeBridge: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/agent-auth", () => accessMocks);

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string; connectionState: string }) => unknown,
  ) => selector({ runtimeUrl: "http://127.0.0.1:8457", connectionState: "healthy" }),
}));

function renderPrompt(harnessKind = "grok") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HarnessNativeBridgePrompt harnessKind={harnessKind} displayName="Grok" />
    </QueryClientProvider>,
  );
}

describe("HarnessNativeBridgePrompt", () => {
  beforeEach(() => {
    accessMocks.getNativeBridge.mockReset();
    accessMocks.dismissNativeBridge.mockReset();
  });
  afterEach(cleanup);

  it("shows the one-time prompt only while the harness holds the legacy flag", async () => {
    accessMocks.getNativeBridge.mockResolvedValue({
      seeded: true,
      harnesses: ["grok"],
    });
    renderPrompt("grok");
    expect(
      await screen.findByText("Grok is using your own login"),
    ).toBeTruthy();
  });

  it("renders nothing for a harness the bridge does not list", async () => {
    accessMocks.getNativeBridge.mockResolvedValue({
      seeded: true,
      harnesses: ["claude"],
    });
    const { container } = renderPrompt("grok");
    await waitFor(() => expect(accessMocks.getNativeBridge).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("dismiss performs the dismiss-to-configure act against the runtime", async () => {
    accessMocks.getNativeBridge.mockResolvedValue({
      seeded: true,
      harnesses: ["grok"],
    });
    accessMocks.dismissNativeBridge.mockResolvedValue(undefined);
    renderPrompt("grok");
    const dismiss = await screen.findByRole("button", { name: "Dismiss" });
    await userEvent.click(dismiss);
    await waitFor(() =>
      expect(accessMocks.dismissNativeBridge).toHaveBeenCalledWith(
        { runtimeUrl: "http://127.0.0.1:8457" },
        "grok",
      ),
    );
  });
});
