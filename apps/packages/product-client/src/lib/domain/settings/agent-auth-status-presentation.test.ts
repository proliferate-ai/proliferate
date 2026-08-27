import { describe, expect, it } from "vitest";
import {
  formatEvidenceAge,
  isStatusGreen,
  statusEvidenceLine,
  statusLabel,
  statusRecheckingMarker,
  statusTone,
  type HarnessStatusFacts,
} from "#product/lib/domain/settings/agent-auth-status-presentation";

const OBSERVED_AT = "2026-08-27T00:00:00Z";
const NOW = Date.parse("2026-08-27T00:02:00Z");

function facts(overrides: Partial<HarnessStatusFacts> = {}): HarnessStatusFacts {
  return {
    applied: { kind: "seat", seat_id: "seat-1" },
    probe: { verdict: "unverified", at: null, stale: false },
    ...overrides,
  };
}

describe("isStatusGreen — green needs dated evidence", () => {
  it("is green for a verified observation with a timestamp", () => {
    expect(
      isStatusGreen(facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: false } })),
    ).toBe(true);
  });

  it("is NOT green for a verified verdict with no timestamp", () => {
    expect(
      isStatusGreen(facts({ probe: { verdict: "verified", at: null, stale: false } })),
    ).toBe(false);
  });

  it("stays green while a re-probe runs — the light dims, it never goes out", () => {
    expect(
      isStatusGreen(facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: true } })),
    ).toBe(true);
  });

  it("is never green without a document at all", () => {
    expect(isStatusGreen(facts({ probe: null }))).toBe(false);
  });

  it("is never green for an unknown verdict from a newer runtime", () => {
    expect(
      isStatusGreen(
        facts({ probe: { verdict: "quantum_ok", at: OBSERVED_AT, stale: false } }),
      ),
    ).toBe(false);
  });
});

describe("statusTone", () => {
  it("is neutral with no document — an unknown state gates nothing", () => {
    expect(statusTone(facts({ probe: null }))).toBe("neutral");
  });

  it("is destructive on a failed observation", () => {
    expect(
      statusTone(facts({ probe: { verdict: "failed", at: OBSERVED_AT, stale: false } })),
    ).toBe("destructive");
  });

  it("is warning while an applied method is unobserved", () => {
    expect(statusTone(facts())).toBe("warning");
  });

  it("is neutral with nothing applied — no fault, no warning", () => {
    expect(statusTone(facts({ applied: null }))).toBe("neutral");
  });

  it("keeps an unknown verdict neutral, never success", () => {
    expect(
      statusTone(facts({ probe: { verdict: "quantum_ok", at: OBSERVED_AT, stale: false } })),
    ).toBe("neutral");
  });
});

describe("statusLabel", () => {
  it("names the absent document rather than inventing a state", () => {
    expect(statusLabel(facts({ probe: null }))).toBe("Waiting for status");
  });

  it("names green, failed, unobserved, and unconfigured", () => {
    expect(
      statusLabel(facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: false } })),
    ).toBe("Authenticated");
    expect(
      statusLabel(facts({ probe: { verdict: "failed", at: OBSERVED_AT, stale: false } })),
    ).toBe("Not authenticated");
    expect(statusLabel(facts())).toBe("Not verified");
    expect(statusLabel(facts({ applied: null }))).toBe("Not configured");
  });
});

describe("formatEvidenceAge", () => {
  it("is coarse and never negative", () => {
    expect(formatEvidenceAge(0)).toBe("0s");
    expect(formatEvidenceAge(-10)).toBe("0s");
    expect(formatEvidenceAge(59)).toBe("59s");
    expect(formatEvidenceAge(120)).toBe("2m");
    expect(formatEvidenceAge(3 * 3600)).toBe("3h");
    expect(formatEvidenceAge(5 * 86_400)).toBe("5d");
  });
});

describe("statusEvidenceLine", () => {
  it("dates a green badge", () => {
    expect(
      statusEvidenceLine(
        facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: false } }),
        NOW,
      ),
    ).toBe("verified 2m ago");
  });

  it("survives staleness — the last observation keeps its age", () => {
    expect(
      statusEvidenceLine(
        facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: true } }),
        NOW,
      ),
    ).toBe("verified 2m ago");
  });

  it("is null on a non-green status, and on an unparseable timestamp", () => {
    expect(statusEvidenceLine(facts(), NOW)).toBeNull();
    expect(
      statusEvidenceLine(
        facts({ probe: { verdict: "verified", at: "not a date", stale: false } }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("statusRecheckingMarker", () => {
  it("marks a stale document and nothing else", () => {
    expect(
      statusRecheckingMarker(
        facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: true } }),
      ),
    ).toBe("re-checking");
    expect(statusRecheckingMarker(facts())).toBeNull();
    expect(statusRecheckingMarker(facts({ probe: null }))).toBeNull();
  });
});
