// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessAuthEvidenceBadge } from "#product/components/settings/panes/agents/harness/HarnessAuthEvidenceBadge";
import type { HarnessStatus } from "#product/hooks/access/anyharness/agent-auth/use-harness-status";
import { harnessStatusFixture } from "#product/hooks/access/anyharness/agent-auth/use-harness-status.fixtures";

const NOW = Date.parse("2026-08-27T00:02:00Z");
const OBSERVED_AT = "2026-08-27T00:00:00Z";

// The evidence age is read off the wall clock inside the component. Pinning
// Date.now is the whole seam — the badge ships no `now` prop that only a test
// ever passes.
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function statusFor(overrides: Partial<HarnessStatus> = {}): HarnessStatus {
  return harnessStatusFixture({
    applied: { kind: "seat", seat_id: "seat-1" },
    ...overrides,
  });
}

function badgeElement() {
  return document.querySelector("[data-harness-probe-verdict]");
}

/** The Badge's success tone is the only green; assert via its own class. */
function isGreen() {
  return (badgeElement()?.className ?? "").includes("success");
}

describe("HarnessAuthEvidenceBadge — the document, verbatim", () => {
  it("is green with its evidence age on a dated verified observation", () => {
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({
          probe: { verdict: "verified", at: OBSERVED_AT, stale: false },
        })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("Authenticated")).toBeTruthy();
    expect(screen.getByText("verified 2m ago")).toBeTruthy();
    expect(isGreen()).toBe(true);
  });

  it("refuses green for a verified verdict with no evidence age", () => {
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({
          probe: { verdict: "verified", at: null, stale: false },
        })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(isGreen()).toBe(false);
    expect(document.querySelector("[data-harness-evidence-age]")).toBeNull();
  });

  it("renders a STALE document as stale-with-last-observation, not as loading", () => {
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({
          probe: { verdict: "verified", at: OBSERVED_AT, stale: true },
          // A stale document is never a loading state, even mid-read.
          loading: true,
        })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    // The last observation stays on screen, its age carried by the ruled stale
    // marker (founder-ruled 2026-08-27: "last checked <age> ago — retrying").
    // The light dims; it never goes out.
    expect(screen.getByText("Authenticated")).toBeTruthy();
    expect(document.querySelector("[data-harness-rechecking]")?.textContent)
      .toBe("last checked 2m ago — retrying");
    // The age is said once, in the marker — the evidence line yields to it.
    expect(document.querySelector("[data-harness-evidence-age]")).toBeNull();
    expect(badgeElement()?.getAttribute("data-harness-probe-stale")).toBe("true");
    expect(isGreen()).toBe(true);
  });

  it("keeps a stale FAILED observation's words rather than going dark", () => {
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({
          probe: { verdict: "failed", at: OBSERVED_AT, stale: true },
        })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("Not authenticated")).toBeTruthy();
    expect(document.querySelector("[data-harness-rechecking]")?.textContent)
      .toBe("last checked 2m ago — retrying");
  });

  it("renders an unknown harness neutrally and gates nothing", () => {
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({ probe: null, applied: null })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("Waiting for status")).toBeTruthy();
    expect(badgeElement()?.getAttribute("data-harness-probe-verdict")).toBe(
      "unknown",
    );
    expect(isGreen()).toBe(false);
    // The refresh affordance stays clickable: a badge never gates an action.
    expect(screen.getByLabelText("Refresh status").hasAttribute("disabled"))
      .toBe(false);
  });

  it("names nothing configured as such, in neutral", () => {
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({ applied: null })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(isGreen()).toBe(false);
  });

  it("words a green native login with nothing applied as the user's own (ruled 2026-08-27)", () => {
    // Native is a PERMANENT supported method: detected login + green probe +
    // nothing routed applied is a healthy terminal — success tone, the native
    // wording, its evidence age, and nothing that reads like a deficiency.
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({
          applied: null,
          probe: { verdict: "verified", at: OBSERVED_AT, stale: false },
        })}
        nativeDetected
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("Using your own login")).toBeTruthy();
    expect(screen.getByText("verified 2m ago")).toBeTruthy();
    expect(isGreen()).toBe(true);
    expect(screen.queryByText("Not configured")).toBeNull();
  });

  it("never greens an unknown future verdict, and fakes no evidence age", () => {
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor({
          probe: {
            verdict: "some_future_verdict",
            at: OBSERVED_AT,
            stale: false,
          } as unknown as NonNullable<HarnessStatus["probe"]>,
        })}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(badgeElement()?.getAttribute("data-harness-probe-verdict")).toBe(
      "some_future_verdict",
    );
    expect(isGreen()).toBe(false);
    expect(document.querySelector("[data-harness-evidence-age]")).toBeNull();
  });

  it("re-reads on refresh — the frontend never probes on its own", () => {
    const onRefresh = vi.fn();
    render(
      <HarnessAuthEvidenceBadge
        status={statusFor()}
        refreshing={false}
        onRefresh={onRefresh}
      />,
    );

    screen.getByLabelText("Refresh status").click();
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
