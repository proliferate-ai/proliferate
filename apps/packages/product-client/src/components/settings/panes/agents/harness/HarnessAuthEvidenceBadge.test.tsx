// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HarnessAuthEvidenceBadge,
  HarnessAuthEvidenceSummary,
} from "#product/components/settings/panes/agents/harness/HarnessAuthEvidenceBadge";
import type {
  AgentAuthDisplay,
  AgentAuthState,
} from "#product/lib/domain/settings/agent-auth-evidence";

afterEach(cleanup);

function stateFor(
  display: AgentAuthDisplay,
  extra: Partial<AgentAuthState> = {},
): AgentAuthState {
  return {
    display,
    nextAction: "none",
    facts: {
      installed: true,
      expired: false,
      misconfigured: false,
      unsupportedRoute: false,
      probe: { phase: "idle", observationNonempty: false },
    },
    ...extra,
  } as AgentAuthState;
}

const ALL_DISPLAYS: AgentAuthDisplay[] = [
  "not_installed",
  "unsupported",
  "misconfigured",
  "expired",
  "unavailable",
  "probing",
  "usable",
  "authenticated",
  "selected",
  "installed",
];

describe("HarnessAuthEvidenceBadge", () => {
  it("renders each display's state name and marks green ONLY for usable/authenticated", () => {
    for (const display of ALL_DISPLAYS) {
      const { unmount } = render(
        <HarnessAuthEvidenceBadge
          authState={stateFor(display)}
          refreshing={false}
          onRefresh={() => {}}
        />,
      );
      const badge = document.querySelector("[data-harness-display]");
      expect(badge?.getAttribute("data-harness-display")).toBe(display);
      // The success tone is the only green; assert via the Badge's own class.
      const isGreen = display === "usable" || display === "authenticated";
      // Badge success tone renders text-success; other tones do not.
      const html = badge?.className ?? "";
      expect(html.includes("success")).toBe(isGreen);
      unmount();
    }
  });

  it("shows the evidence age on a green badge", () => {
    render(
      <HarnessAuthEvidenceBadge
        authState={stateFor("usable", { evidenceAgeSeconds: 120 })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText("verified 2m ago")).toBeTruthy();
  });

  it("never shows an evidence age on a non-green badge", () => {
    render(
      <HarnessAuthEvidenceBadge
        authState={stateFor("installed", { evidenceAgeSeconds: 30 })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByText(/verified/)).toBeNull();
  });
});

describe("HarnessAuthEvidenceSummary", () => {
  it("renders the next-action affordance", () => {
    render(
      <HarnessAuthEvidenceSummary
        authState={stateFor("installed", { nextAction: "log_in_or_paste_key" })}
      />,
    );
    expect(screen.getByText("Log in or paste a key")).toBeTruthy();
  });

  it("renders the probe backoff with its next-attempt countdown", () => {
    const now = Date.parse("2026-08-15T00:00:00Z");
    render(
      <HarnessAuthEvidenceSummary
        now={now}
        authState={stateFor("probing", {
          facts: {
            installed: true,
            expired: false,
            misconfigured: false,
            unsupportedRoute: false,
            probe: {
              phase: "backoff",
              observationNonempty: false,
              nextAttemptAt: "2026-08-15T00:02:00Z",
              lastFailureDetail: "429 rate limited",
            },
          },
        } as Partial<AgentAuthState>)}
      />,
    );
    expect(screen.getByText(/Next attempt in 2m/)).toBeTruthy();
    expect(screen.getByText(/429 rate limited/)).toBeTruthy();
  });

  it("renders a retry affordance for a cancelled handoff", () => {
    const onRetry = vi.fn();
    render(
      <HarnessAuthEvidenceSummary
        onRetryHandoff={onRetry}
        authState={stateFor("installed", {
          facts: {
            installed: true,
            expired: false,
            misconfigured: false,
            unsupportedRoute: false,
            probe: { phase: "idle", observationNonempty: false },
            handoff: "cancelled",
          },
        } as Partial<AgentAuthState>)}
      />,
    );
    expect(screen.getByText("Sign-in cancelled")).toBeTruthy();
    screen.getByText("Retry").click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders nothing extra when the runtime filled no probe/handoff slots", () => {
    const { container } = render(
      <HarnessAuthEvidenceSummary authState={stateFor("usable")} />,
    );
    // nextAction none + idle probe + null handoff => empty summary wrapper.
    expect(container.querySelector("[data-harness-probe-phase]")).toBeNull();
    expect(container.querySelector("[data-harness-handoff]")).toBeNull();
  });
});
