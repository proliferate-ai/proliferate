// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeIntegration, NativeIntegrationsResponse } from "@anyharness/sdk";
import { HarnessNativeIntegrationsSection } from "#product/components/settings/panes/agents/harness/HarnessNativeIntegrationsSection";

const clientMocks = vi.hoisted(() => ({
  listNativeIntegrations: vi.fn(),
  setNativeIntegrationSelection: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessCacheScopeKey: () => "test-scope",
  getAnyHarnessClient: () => ({ agents: clientMocks }),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string; connectionState: string }) => unknown,
  ) => selector({ runtimeUrl: "http://127.0.0.1:8457", connectionState: "healthy" }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

const computerUseBundle: NativeIntegration = {
  id: "bundle:computer-use",
  agentKind: "codex",
  kind: "bundle",
  displayName: "Computer Use",
  description: "Drive the desktop through the Codex app.",
  available: true,
  risk: "desktop_control",
  enabled: false,
};

const chromeBundle: NativeIntegration = {
  id: "bundle:chrome",
  agentKind: "codex",
  kind: "bundle",
  displayName: "Chrome browser use",
  description: "Drive Chrome through the Codex browser service.",
  available: true,
  risk: "browser_control",
  enabled: false,
};

const rawLinearServer: NativeIntegration = {
  id: "mcp:linear",
  agentKind: "codex",
  kind: "mcp_stdio",
  displayName: "linear",
  source: "~/.codex/config.toml · mcp_servers.linear",
  available: true,
  risk: "none",
  enabled: true,
};

function listing(overrides?: Partial<NativeIntegrationsResponse>): NativeIntegrationsResponse {
  return {
    agentKind: "codex",
    integrations: [computerUseBundle, chromeBundle, rawLinearServer],
    staleSelections: [],
    ...overrides,
  };
}

function renderSection(
  surface: "local" | "cloud" = "local",
  harness: { kind: string; displayName: string } = { kind: "codex", displayName: "Codex" },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HarnessNativeIntegrationsSection
        harnessKind={harness.kind}
        displayName={harness.displayName}
        surface={surface}
      />
    </QueryClientProvider>,
  );
}

describe("HarnessNativeIntegrationsSection", () => {
  beforeEach(() => {
    clientMocks.listNativeIntegrations.mockReset();
    clientMocks.setNativeIntegrationSelection.mockReset();
  });
  afterEach(cleanup);

  it("lists the discovered integrations with each bundle's risk badge and the raw row's source", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing());
    renderSection();

    expect(await screen.findByText("From your Codex setup")).toBeTruthy();
    expect(screen.getByText("Computer Use")).toBeTruthy();
    expect(screen.getByText("Controls your desktop")).toBeTruthy();
    expect(screen.getByText("Chrome browser use")).toBeTruthy();
    expect(screen.getByText("Controls your browser")).toBeTruthy();
    expect(screen.getByText("linear")).toBeTruthy();
    expect(screen.getByText("~/.codex/config.toml · mcp_servers.linear")).toBeTruthy();
  });

  it("renders nothing at all when discovery finds nothing", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(
      listing({ integrations: [], staleSelections: [] }),
    );
    const { container } = renderSection();
    await waitFor(() => expect(clientMocks.listNativeIntegrations).toHaveBeenCalled());
    expect(container.querySelector("section")).toBeNull();
  });

  it("renders nothing on the cloud surface, where discovery finds nothing by law", () => {
    const { container } = renderSection("cloud");
    expect(container.firstChild).toBeNull();
    expect(clientMocks.listNativeIntegrations).not.toHaveBeenCalled();
  });

  it("disables the switch of an unavailable integration and shows the reason", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing({
      integrations: [{
        ...computerUseBundle,
        available: false,
        unavailableReason: "Codex desktop app not installed.",
      }],
    }));
    renderSection();

    const toggle = await screen.findByRole("switch", { name: "Computer Use" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Codex desktop app not installed.")).toBeTruthy();
  });

  it("keeps an unavailable raw row's mono source and appends the reason after it", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing({
      integrations: [{
        ...rawLinearServer,
        enabled: false,
        available: false,
        unavailableReason: "disabled natively (enabled = false)",
      }],
    }));
    renderSection();

    const row = await screen.findByTestId("native-integration-mcp:linear");
    const source = within(row).getByText("~/.codex/config.toml · mcp_servers.linear");
    expect(source.className).toContain("font-mono");
    expect(row.textContent).toContain(
      "~/.codex/config.toml · mcp_servers.linear · disabled natively (enabled = false)",
    );
  });

  it("renders a stale selection with a Missing badge and its toggle still on", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing({
      integrations: [],
      staleSelections: ["mcp:removed-server"],
    }));
    renderSection();

    expect(await screen.findByText("removed-server")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "removed-server" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
  });

  it("applies a no-risk toggle immediately with the flipped enabled value", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing());
    clientMocks.setNativeIntegrationSelection.mockResolvedValue(
      listing({ integrations: [computerUseBundle, { ...rawLinearServer, enabled: false }] }),
    );
    renderSection();

    await userEvent.click(await screen.findByRole("switch", { name: "linear" }));
    await waitFor(() =>
      expect(clientMocks.setNativeIntegrationSelection).toHaveBeenCalledWith(
        "codex",
        "mcp:linear",
        false,
      ),
    );
  });

  it("gates a desktop-control toggle behind the consent dialog and only writes on confirm", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing());
    clientMocks.setNativeIntegrationSelection.mockResolvedValue(
      listing({ integrations: [{ ...computerUseBundle, enabled: true }, rawLinearServer] }),
    );
    renderSection();

    await userEvent.click(await screen.findByRole("switch", { name: "Computer Use" }));
    expect(clientMocks.setNativeIntegrationSelection).not.toHaveBeenCalled();
    // The title renders twice by design: Radix's sr-only DialogTitle plus the
    // visible header.
    expect(await screen.findAllByText("Turn on Computer Use for Codex?")).not.toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Turn on Computer Use" }));
    await waitFor(() =>
      expect(clientMocks.setNativeIntegrationSelection).toHaveBeenCalledWith(
        "codex",
        "bundle:computer-use",
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.queryAllByText("Turn on Computer Use for Codex?")).toHaveLength(0),
    );
  });

  it("gates a browser-control toggle behind the consent dialog with the browser facts", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing());
    clientMocks.setNativeIntegrationSelection.mockResolvedValue(
      listing({
        integrations: [computerUseBundle, { ...chromeBundle, enabled: true }, rawLinearServer],
      }),
    );
    renderSection();

    await userEvent.click(await screen.findByRole("switch", { name: "Chrome browser use" }));
    expect(clientMocks.setNativeIntegrationSelection).not.toHaveBeenCalled();
    // The title renders twice by design: Radix's sr-only DialogTitle plus the
    // visible header.
    expect(await screen.findAllByText("Turn on Chrome browser use for Codex?")).not.toHaveLength(0);
    // The browser body, not the desktop one: the injected server is
    // browser_repl for chrome (cua_repl belongs to computer use).
    expect(screen.getAllByText(/browser_repl/)).not.toHaveLength(0);
    expect(screen.queryAllByText(/cua_repl/)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Turn on Chrome browser use" }));
    await waitFor(() =>
      expect(clientMocks.setNativeIntegrationSelection).toHaveBeenCalledWith(
        "codex",
        "bundle:chrome",
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.queryAllByText("Turn on Chrome browser use for Codex?")).toHaveLength(0),
    );
  });

  it("gates the Claude in Chrome bundle behind consent with the per-action approval facts", async () => {
    const claudeChrome: NativeIntegration = {
      id: "bundle:claude-chrome",
      agentKind: "claude",
      kind: "bundle",
      displayName: "Claude in Chrome",
      description: "Drive Chrome through the Claude in Chrome extension.",
      available: true,
      risk: "browser_control",
      enabled: false,
    };
    clientMocks.listNativeIntegrations.mockResolvedValue(
      listing({ agentKind: "claude", integrations: [claudeChrome] }),
    );
    clientMocks.setNativeIntegrationSelection.mockResolvedValue(
      listing({ agentKind: "claude", integrations: [{ ...claudeChrome, enabled: true }] }),
    );
    renderSection("local", { kind: "claude", displayName: "Claude" });

    await userEvent.click(await screen.findByRole("switch", { name: "Claude in Chrome" }));
    expect(clientMocks.setNativeIntegrationSelection).not.toHaveBeenCalled();
    expect(await screen.findAllByText("Turn on Claude in Chrome for Claude?")).not.toHaveLength(0);
    // The Claude body: per-action approval and the CLI's own server name —
    // never the codex browser service or browser_repl.
    expect(screen.getAllByText(/claude-in-chrome/)).not.toHaveLength(0);
    expect(screen.queryAllByText(/browser_repl/)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Turn on Claude in Chrome" }));
    await waitFor(() =>
      expect(clientMocks.setNativeIntegrationSelection).toHaveBeenCalledWith(
        "claude",
        "bundle:claude-chrome",
        true,
      ),
    );
  });

  it("cancelling the consent dialog writes nothing and leaves the toggle off", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(listing());
    renderSection();

    await userEvent.click(await screen.findByRole("switch", { name: "Computer Use" }));
    await screen.findAllByText("Turn on Computer Use for Codex?");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryAllByText("Turn on Computer Use for Codex?")).toHaveLength(0),
    );
    expect(clientMocks.setNativeIntegrationSelection).not.toHaveBeenCalled();
    const toggle = screen.getByRole("switch", { name: "Computer Use" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});
