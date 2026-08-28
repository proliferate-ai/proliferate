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

  it("is success for a green native login with nothing applied (ruled 2026-08-27)", () => {
    // Native is a permanent supported method: a working own-login harness is
    // healthy, never warning-toned, never gated.
    expect(
      statusTone(
        facts({
          applied: null,
          nativeDetected: true,
          probe: { verdict: "verified", at: OBSERVED_AT, stale: false },
        }),
      ),
    ).toBe("success");
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

  it("words a green, nothing-applied, native-detected harness in its own voice", () => {
    // Founder-ruled 2026-08-27: native is a PERMANENT supported method. This is
    // a healthy terminal state, not a deficiency — never "Not configured".
    expect(
      statusLabel(
        facts({
          applied: null,
          nativeDetected: true,
          probe: { verdict: "verified", at: OBSERVED_AT, stale: false },
        }),
      ),
    ).toBe("Using your own login");
    // With a routed method applied, green keeps its plain word.
    expect(
      statusLabel(
        facts({
          nativeDetected: true,
          probe: { verdict: "verified", at: OBSERVED_AT, stale: false },
        }),
      ),
    ).toBe("Authenticated");
    // Nothing applied and NO native detection keeps the honest non-green words.
    expect(
      statusLabel(
        facts({
          applied: null,
          nativeDetected: false,
          probe: { verdict: "unverified", at: null, stale: false },
        }),
      ),
    ).toBe("Not configured");
  });
});

// Founder ruling 2026-08-27, after the acceptance-gate false green (PR #2254):
// an applied SEAT may never borrow the machine's own native login for its green.
// The ruling was pinned on `deriveAuthStatus`, which slice 3 deleted with
// `HarnessAuthStatusBadge.tsx` (FE-PATHS-1 keeps it deleted); it is re-homed
// here, against the status document, because `nativeDetected` is the one field
// in this shape through which the machine's own login could still leak into a
// seat's badge. Hand-falsified: dropping the `applied === null` guard from
// `statusLabel`'s green arm turns the first case green.
describe("an applied seat never borrows the native login (ruled 2026-08-27)", () => {
  it("stays Not verified with a detected native login and no observation of its own", () => {
    const seatWithNativeLogin = facts({
      applied: { kind: "seat", seat_id: "seat-1" },
      nativeDetected: true,
      probe: { verdict: "unverified", at: null, stale: false },
    });
    expect(isStatusGreen(seatWithNativeLogin)).toBe(false);
    expect(statusTone(seatWithNativeLogin)).toBe("warning");
    expect(statusLabel(seatWithNativeLogin)).toBe("Not verified");
  });

  it("reads red on a rejected seat trial, native login present or not", () => {
    // The tier-1 trial's 401 folds onto the document as a dated `failed`.
    const rejected = facts({
      applied: { kind: "seat", seat_id: "seat-1" },
      nativeDetected: true,
      probe: { verdict: "failed", at: OBSERVED_AT, stale: false },
    });
    expect(statusTone(rejected)).toBe("destructive");
    expect(statusLabel(rejected)).toBe("Not authenticated");
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

  it("yields to the stale marker while a re-probe runs (ruled 2026-08-27)", () => {
    // The observation's age is not lost — it moves into the stale marker
    // ("last checked 2m ago — retrying"), so the evidence line stays silent
    // rather than printing the same age twice.
    expect(
      statusEvidenceLine(
        facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: true } }),
        NOW,
      ),
    ).toBeNull();
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

describe("statusRecheckingMarker — the ruled stale wording (2026-08-27)", () => {
  it("states the observation's age and the retry on a stale document", () => {
    expect(
      statusRecheckingMarker(
        facts({ probe: { verdict: "verified", at: OBSERVED_AT, stale: true } }),
        NOW,
      ),
    ).toBe("last checked 2m ago — retrying");
    // The wording applies to any stale observation, not only a green one.
    expect(
      statusRecheckingMarker(
        facts({ probe: { verdict: "failed", at: OBSERVED_AT, stale: true } }),
        NOW,
      ),
    ).toBe("last checked 2m ago — retrying");
  });

  it("keeps the honest plain marker when nothing was ever observed", () => {
    expect(
      statusRecheckingMarker(
        facts({ probe: { verdict: "unverified", at: null, stale: true } }),
        NOW,
      ),
    ).toBe("re-checking");
    // An unparseable timestamp is not an age either — never fake one.
    expect(
      statusRecheckingMarker(
        facts({ probe: { verdict: "verified", at: "not a date", stale: true } }),
        NOW,
      ),
    ).toBe("re-checking");
  });

  it("marks a stale document and nothing else", () => {
    expect(statusRecheckingMarker(facts(), NOW)).toBeNull();
    expect(statusRecheckingMarker(facts({ probe: null }), NOW)).toBeNull();
  });
});
