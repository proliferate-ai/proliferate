// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAuthSelection, AgentAuthState } from "@proliferate/cloud-sdk";
import { HarnessSettingsSection } from "#product/components/settings/panes/agents/harness/HarnessSettingsSection";

const queries = vi.hoisted(() => ({
  state: { data: undefined as AgentAuthState | undefined },
  selections: { data: undefined as AgentAuthSelection[] | undefined },
  mutate: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentAuthState: () => queries.state,
  useAuthSelections: () => queries.selections,
  usePutAuthSelections: () => ({ mutate: queries.mutate }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false }),
}));

function stateDocument(overrides: Partial<AgentAuthState> = {}): AgentAuthState {
  return { version: 2, revision: 3, user_id: "user-1", harnesses: [], ...overrides };
}

function renderClaudeSettings() {
  return render(<HarnessSettingsSection harnessKind="claude" surface="local" />);
}

afterEach(() => {
  cleanup();
  queries.state.data = undefined;
  queries.selections.data = undefined;
  queries.mutate.mockClear();
});

describe("HarnessSettingsSection", () => {
  it("reads the persisted toggle from the harness_settings rider for a native-auth harness", () => {
    // PRO-129: a native-login harness has NO `harnesses` entry in the rendered
    // document (absent means native), so the persisted value must come from
    // the response's harness_settings rider or the switch snaps back to its
    // default after every toggle.
    queries.state.data = stateDocument({
      harness_settings: { claude: { chrome: true } },
    });
    queries.selections.data = [];
    renderClaudeSettings();
    expect(
      screen
        .getByRole("switch", { name: "Use Claude Code with Chrome" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("falls back to the delivered settings passenger when the rider is absent", () => {
    // Older self-hosted servers respond without the rider; a routed harness
    // still carries its settings inside the document.
    queries.state.data = stateDocument({
      harnesses: [
        {
          harness_kind: "claude",
          sources: [{ kind: "gateway", base_url: "https://gw", key: "sk-vk" }],
          settings: { chrome: true },
        },
      ],
    });
    queries.selections.data = [];
    renderClaudeSettings();
    expect(
      screen
        .getByRole("switch", { name: "Use Claude Code with Chrome" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("commits the flipped value through the selections PUT", () => {
    queries.state.data = stateDocument({ harness_settings: {} });
    queries.selections.data = [];
    renderClaudeSettings();
    fireEvent.click(screen.getByRole("switch", { name: "Use Claude Code with Chrome" }));
    expect(queries.mutate).toHaveBeenCalledWith({
      harnessKind: "claude",
      surface: "local",
      body: { sources: [], settings: { chrome: true } },
    });
  });

  it("does not commit while either read is still loading", () => {
    // The PUT is full desired state: committing before the selections read
    // resolves would clear the harness's auth sources, and committing before
    // the state read would drop sibling setting keys.
    queries.state.data = stateDocument();
    queries.selections.data = undefined;
    renderClaudeSettings();
    const toggle = screen.getByRole("switch", {
      name: "Use Claude Code with Chrome",
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(queries.mutate).not.toHaveBeenCalled();
  });
});
