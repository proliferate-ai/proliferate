import { describe, expect, it } from "vitest";
import {
  evidenceAgeLine,
  isEvidenceGreen,
  labelForDisplay,
  labelForNextAction,
  presentHandoff,
  toneForDisplay,
  type AgentAuthDisplay,
  type AgentAuthState,
} from "#product/lib/domain/settings/agent-auth-evidence";

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

describe("agent-auth-evidence", () => {
  it("marks green ONLY for usable and authenticated", () => {
    for (const display of ALL_DISPLAYS) {
      const green = isEvidenceGreen(display);
      const success = toneForDisplay(display) === "success";
      expect(green).toBe(display === "usable" || display === "authenticated");
      expect(success).toBe(green);
    }
  });

  it("labels every display value", () => {
    for (const display of ALL_DISPLAYS) {
      expect(labelForDisplay(display)).toBeTruthy();
    }
  });

  it("shows evidence age only on a green display that carries one", () => {
    expect(
      evidenceAgeLine(stateFor("usable", { evidenceAgeSeconds: 120 })),
    ).toBe("verified 2m ago");
    expect(
      evidenceAgeLine(stateFor("authenticated", { evidenceAgeSeconds: 5 })),
    ).toBe("verified 5s ago");
    // Green but no age -> no faked freshness.
    expect(evidenceAgeLine(stateFor("usable"))).toBeNull();
    // Non-green never shows an age even if one leaked through.
    expect(
      evidenceAgeLine(stateFor("installed", { evidenceAgeSeconds: 30 })),
    ).toBeNull();
  });

  it("maps each next action to an affordance (none -> null)", () => {
    expect(labelForNextAction("none")).toBeNull();
    expect(labelForNextAction("install")).toBe("Install");
    expect(labelForNextAction("log_in_or_paste_key")).toBe("Log in or paste a key");
    expect(labelForNextAction("choose_source")).toBe("Choose a source");
    expect(labelForNextAction("top_up_or_retry")).toBe("Top up or retry");
    expect(labelForNextAction("wait_for_probe")).toBe("Waiting for probe");
    expect(labelForNextAction("fix_config")).toBe("Fix configuration");
  });

  it("treats an unknown future display as non-green with a neutral fallback tone", () => {
    const future = "some_future_state" as AgentAuthDisplay;
    expect(isEvidenceGreen(future)).toBe(false);
    expect(toneForDisplay(future)).toBe("neutral");
    // A green-only evidence line must not appear for an unknown display even
    // if it somehow carried an age.
    expect(
      evidenceAgeLine(stateFor(future, { evidenceAgeSeconds: 60 })),
    ).toBeNull();
  });

  it("presents handoff states with in-flight and retry affordances", () => {
    expect(presentHandoff("awaiting_browser").inFlight).toBe(true);
    expect(presentHandoff("initiated").inFlight).toBe(true);
    expect(presentHandoff("completed").inFlight).toBe(false);
    expect(presentHandoff("cancelled").retryable).toBe(true);
    expect(presentHandoff("timed_out").retryable).toBe(true);
    expect(presentHandoff("completed").retryable).toBe(false);
  });
});
