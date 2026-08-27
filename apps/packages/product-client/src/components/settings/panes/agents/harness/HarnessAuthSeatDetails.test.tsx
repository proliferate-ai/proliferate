// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeatDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthSeatDetails";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { formatSeatResetTime } from "#product/domain/chats/transcript/seat-usage-limit";

const putMutate = vi.hoisted(() => vi.fn());
const refreshUsageMutate = vi.hoisted(() => vi.fn());
const testState = vi.hoisted(() => ({
  harnessSettings: {
    data: undefined as Record<string, Record<string, unknown>> | undefined,
  },
  // The status document the seam serves. The tags, the next-up marker, and the
  // cooling line all read it verbatim — there is nothing left to duck-type off
  // the agent summary.
  status: {} as Record<string, unknown>,
  // Slice 4's meters live inside the same seat row these tests render, so the
  // usage read is part of this component's contract: default to no samples
  // (each row's honest no-sample state) and seed it per-case where a test
  // asserts the bars.
  seatUsage: { data: [] as Record<string, unknown>[], isLoading: false },
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRevokeAgentApiKey: () => ({ mutate: vi.fn(), isPending: false }),
  useAgentAuthHarnessSettings: () => testState.harnessSettings,
  usePutAuthSelections: () => ({ mutate: putMutate, isPending: false }),
  useSeatUsage: () => testState.seatUsage,
  useRefreshSeatUsage: () => ({ mutate: refreshUsageMutate, isPending: false }),
}));

vi.mock("#product/hooks/agents/workflows/use-seat-mint-workflow", () => ({
  useSeatMintWorkflow: () => ({
    state: { phase: "idle", terminal: null, message: null, error: null },
    startMint: vi.fn(),
    cancelMint: vi.fn(),
  }),
}));

vi.mock("#product/components/agents/AgentLoginTerminalPanel", () => ({
  AgentLoginTerminalPanel: () => <div data-testid="login-terminal" />,
}));

vi.mock("#product/hooks/access/anyharness/agent-auth/use-harness-status", () => ({
  useHarnessStatus: () => ({
    applied: null,
    nextSeatId: null,
    probe: null,
    coolingUntil: null,
    refreshing: false,
    refresh: vi.fn(),
    ...testState.status,
  }),
}));

function seat(id: string, title: string) {
  return {
    id,
    title,
    kind: "anthropic_subscription",
    redactedHint: "sk-...abcd",
    status: "active",
    createdAt: "2026-08-26T00:00:00Z",
  };
}

function editorApi(overrides: {
  seats?: ReturnType<typeof seat>[];
  seatEnabled?: boolean;
} = {}): HarnessAuthEditorApi {
  return {
    authReady: true,
    apiKeysQuery: { data: overrides.seats ?? [] },
    // A resolved selections query is the hook's seeded-editor signal; these
    // tests all render a post-seed editor.
    selectionsQuery: { data: [] },
    editorState: {
      gatewayEnabled: false,
      seatEnabled: overrides.seatEnabled ?? true,
      rows: [],
    },
    handleSeatToggle: vi.fn(),
    localAgent: { kind: "claude" },
    loginWorkflow: {
      runtimeConnection: {
        baseUrl: "http://127.0.0.1:8457",
        authToken: undefined,
        webSocketAuthTransport: undefined,
      },
    },
  } as unknown as HarnessAuthEditorApi;
}

function renderSeatDetails(editor: HarnessAuthEditorApi) {
  return render(<SeatDetails editor={editor} surface="local" />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  testState.harnessSettings.data = undefined;
  testState.status = {};
  testState.seatUsage = { data: [], isLoading: false };
});

describe("SeatDetails rotation tags", () => {
  it("tags the serving and next-up seats on the right rows only", () => {
    // `applied.seat_id` IS the serving seat; `next_seat_id` is the next in line.
    testState.status = {
      applied: { kind: "seat", seat_id: "s1" },
      nextSeatId: "s2",
      unknown: false,
    };
    const { container } = renderSeatDetails(editorApi({
      seats: [seat("s1", "Max seat · a"), seat("s2", "Max seat · b"), seat("s3", "Max seat · c")],
    }));

    const row = (id: string) =>
      within(container.querySelector(`[data-seat-row="${id}"]`) as HTMLElement);
    expect(row("s1").getByText("Serving now")).toBeTruthy();
    expect(row("s1").queryByText("Next up")).toBeNull();
    expect(row("s2").getByText("Next up")).toBeTruthy();
    expect(row("s2").queryByText("Serving now")).toBeNull();
    expect(row("s3").queryByText("Serving now")).toBeNull();
    expect(row("s3").queryByText("Next up")).toBeNull();
  });

  it("shows only the serving tag when the next launch would pick the same seat", () => {
    testState.status = {
      applied: { kind: "seat", seat_id: "s1" },
      nextSeatId: "s1",
      unknown: false,
    };
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")] }));

    expect(screen.getByText("Serving now")).toBeTruthy();
    expect(screen.queryByText("Next up")).toBeNull();
  });

  it("renders no tags when the document holds no rotation state", () => {
    testState.status = { unknown: false };
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")] }));

    expect(screen.queryByText("Serving now")).toBeNull();
    expect(screen.queryByText("Next up")).toBeNull();
  });

  it("shows no serving tag when the applied method is not a seat", () => {
    // A gateway-applied harness has no serving seat, whatever the pool holds.
    testState.status = {
      applied: { kind: "gateway" },
      nextSeatId: null,
      unknown: false,
    };
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")] }));

    expect(screen.queryByText("Serving now")).toBeNull();
  });
});

describe("SeatDetails cooling line", () => {
  it("renders the no-serve cooling line with the formatted next reset", () => {
    const coolingUntil = "2026-01-05T18:00:00Z";
    testState.status = { coolingUntil, unknown: false };
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")] }));

    const time = formatSeatResetTime(coolingUntil);
    expect(time).not.toBeNull();
    // Worded to be true in both no-serve cases: all logins cooling, or the
    // rotate-off pinned login cooling.
    expect(
      screen.getByText(`No login can serve right now — the next reset is at ${time}.`),
    ).toBeTruthy();
  });

  it("renders no cooling line while a seat can serve", () => {
    testState.status = {
      applied: { kind: "seat", seat_id: "s1" },
      coolingUntil: null,
      unknown: false,
    };
    const { container } = renderSeatDetails(editorApi({
      seats: [seat("s1", "Max seat · a")],
    }));

    expect(container.querySelector("[data-seat-cooling-line]")).toBeNull();
  });
});

describe("SeatDetails rotate switch", () => {
  it("reflects the settings rider value and defaults to on", () => {
    testState.harnessSettings.data = { claude: { rotate: false } };
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")] }));
    const rotate = screen.getByRole("switch", { name: "Rotate between logins" });
    expect(rotate.getAttribute("aria-checked")).toBe("false");

    cleanup();
    testState.harnessSettings.data = { claude: {} };
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")] }));
    expect(
      screen.getByRole("switch", { name: "Rotate between logins" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("PUTs the current sources unchanged plus settings, preserving other keys", () => {
    testState.harnessSettings.data = {
      claude: { rotate: true, someOtherToggle: true },
    };
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")], seatEnabled: true }));

    fireEvent.click(screen.getByRole("switch", { name: "Rotate between logins" }));

    expect(putMutate).toHaveBeenCalledTimes(1);
    expect(putMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: {
          sources: [
            { sourceKind: "gateway", enabled: false },
            { sourceKind: "seat", enabled: true },
          ],
          settings: { rotate: false, someOtherToggle: true },
        },
      },
      expect.anything(),
    );
  });

  it("disables the switch until the settings rider has loaded", () => {
    renderSeatDetails(editorApi({ seats: [seat("s1", "Max seat · a")] }));
    const rotate = screen.getByRole("switch", { name: "Rotate between logins" });
    expect((rotate as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("SeatDetails rotation tags and usage meters in one row", () => {
  // The composition proof (slices 3 + 4): slice 2's serving-now/next-up tags
  // and slice 4's 5h/7d meters are additive inside the SAME seat row. A merge
  // that dropped either half — or that left the usage read unwired — fails
  // here rather than in a demo.
  it("renders the serving tag, the meters, and the rotate switch together", () => {
    testState.seatUsage = {
      data: [
        {
          apiKeyId: "s1",
          util5h: 0.63,
          util7d: 0.2,
          reset5h: null,
          reset7d: null,
          bindingWindow: "five_hour",
          status: "allowed",
          sampledAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
    };
    testState.harnessSettings.data = { claude: { rotate: true } };
    testState.status = {
      applied: { kind: "seat", seat_id: "s1" },
      nextSeatId: "s2",
      unknown: false,
    };

    const { container } = renderSeatDetails(editorApi({
      seats: [seat("s1", "Max seat · a"), seat("s2", "Max seat · b")],
    }));

    const servingRow = within(
      container.querySelector('[data-seat-row="s1"]') as HTMLElement,
    );
    // Slice 2's half.
    expect(servingRow.getByText("Serving now")).toBeTruthy();
    // Slice 4's half, in the same row.
    expect(servingRow.getByText("5-hour")).toBeTruthy();
    expect(servingRow.getByText("7-day")).toBeTruthy();
    expect(servingRow.getByText("63%")).toBeTruthy();
    // The seat with no sample keeps the honest empty state, not a borrowed bar.
    const nextRow = within(
      container.querySelector('[data-seat-row="s2"]') as HTMLElement,
    );
    expect(nextRow.getByText("Next up")).toBeTruthy();
    expect(nextRow.getByText("No usage data yet.")).toBeTruthy();
    // And the rotate switch still rides below the rows.
    expect(screen.getByRole("switch", { name: "Rotate between logins" })).toBeTruthy();
    // The pane-open poke fired once for this mount (flow 5).
    expect(refreshUsageMutate).toHaveBeenCalled();
  });
});
