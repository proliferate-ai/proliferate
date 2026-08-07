import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_TOAST_DURATION_MS,
  isStatusToast,
  resolveToastDuration,
  STATUS_TOAST_DURATION_MS,
  toErrorAnnouncement,
} from "#product/primitives/utils/toast-model";

const noop = () => {};

/**
 * The persistence rule is the load-bearing half of the toast contract: a toast
 * that asked a question must not answer it by disappearing. These cases pin
 * that, and the default-weight rule that makes `toast("…")` a status line.
 */
describe("isStatusToast", () => {
  it("treats an absent weight as status, because status is the default", () => {
    expect(isStatusToast({ message: "Saved" })).toBe(true);
  });

  it("treats an explicit status weight as status", () => {
    expect(isStatusToast({ weight: "status", message: "Saved" })).toBe(true);
  });

  it("does not treat announcement or detail as status", () => {
    expect(isStatusToast({ weight: "announcement", title: "Saved" })).toBe(false);
    expect(
      isStatusToast({ weight: "detail", title: "Saved", payload: "a.ts" }),
    ).toBe(false);
  });
});

describe("resolveToastDuration", () => {
  it("gives a bare status line four seconds", () => {
    expect(resolveToastDuration({ message: "Saved" })).toBe(
      STATUS_TOAST_DURATION_MS,
    );
  });

  it("gives a bare announcement eight seconds", () => {
    expect(
      resolveToastDuration({ weight: "announcement", title: "Deploy finished" }),
    ).toBe(ANNOUNCEMENT_TOAST_DURATION_MS);
  });

  it("keeps a status line with an action until dismissed", () => {
    expect(
      resolveToastDuration({
        message: "Draft discarded",
        action: { label: "Undo", onClick: noop },
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps anything carrying an error until dismissed", () => {
    expect(
      resolveToastDuration({
        weight: "announcement",
        title: "Update failed",
        isError: true,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it.each([
    ["commit", { commit: { label: "Restart", onClick: noop } }],
    ["secondary", { secondary: { label: "Later", onClick: noop } }],
    ["inline details", {
      details: { kind: "inline" as const, payload: "a.ts" },
    }],
    ["navigate details", {
      details: { kind: "navigate" as const, onNavigate: noop },
    }],
  ])("keeps an announcement with %s until dismissed", (_name, extra) => {
    expect(
      resolveToastDuration({ weight: "announcement", title: "Choose", ...extra }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps every detail toast until dismissed, actions or not", () => {
    expect(
      resolveToastDuration({
        weight: "detail",
        title: "3 fields need attention",
        payload: "a\nb",
        jump: { label: "Open workflow", onClick: noop },
      }),
    ).toBe(Number.POSITIVE_INFINITY);
    // A payload exists to be read, and reading takes longer than any dwell.
    expect(
      resolveToastDuration({
        weight: "detail",
        title: "3 fields need attention",
        payload: "a\nb",
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not treat details: none as an action", () => {
    expect(
      resolveToastDuration({
        weight: "announcement",
        title: "Deploy finished",
        details: { kind: "none" },
      }),
    ).toBe(ANNOUNCEMENT_TOAST_DURATION_MS);
  });

  it("lets a caller shorten a dwell but not shorten a decision", () => {
    expect(
      resolveToastDuration({ weight: "announcement", title: "Up to date", duration: 4_000 }),
    ).toBe(4_000);
    // The same short duration is ignored once there is something to answer.
    expect(
      resolveToastDuration({
        weight: "announcement",
        title: "Update failed",
        duration: 4_000,
        isError: true,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

/**
 * An error toast is the one weight decided by classification rather than by the
 * caller: an error from something the user just did always needs a decision, so
 * it is always an announcement that persists. These cases pin that, and pin the
 * separation that the shape exists for — the cause never becomes copy.
 */
describe("toErrorAnnouncement", () => {
  it("classifies every error as a persisting announcement", () => {
    const announcement = toErrorAnnouncement({ headline: "Message not sent" });

    expect(announcement.weight).toBe("announcement");
    expect(announcement.tone).toBe("destructive");
    expect(announcement.isError).toBe(true);
    expect(resolveToastDuration(announcement)).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the cause out of every rendered field", () => {
    const cause = "TypeError: undefined is not a function\n  at step (run.ts:10:1)";
    const announcement = toErrorAnnouncement({
      headline: "Run did not start",
      consequence: "No files were changed.",
      cause,
    });

    expect(announcement.title).toBe("Run did not start");
    expect(announcement.description).toBe("No files were changed.");
    // The only field the cause reaches is the details payload, which renders in
    // the expanded strip behind the Details toggle — never in the toast body.
    expect(announcement.details).toEqual({
      kind: "inline",
      payload: cause,
    });
  });

  it("offers no Details when there is nothing behind it", () => {
    expect(toErrorAnnouncement({ headline: "Link did not open" }).details)
      .toEqual({ kind: "none" });
    // Whitespace is not a cause: it would unfold an empty strip.
    expect(toErrorAnnouncement({ headline: "Link did not open", cause: "  \n" }).details)
      .toEqual({ kind: "none" });
  });

  it("makes retry the one committing action, and nothing else commit", () => {
    const retry = () => {};
    const withRetry = toErrorAnnouncement({ headline: "Message not sent", retry });
    expect(withRetry.commit).toEqual({ label: "Retry", onClick: retry });

    expect(toErrorAnnouncement({ headline: "Message not sent" }).commit).toBeUndefined();
  });

  it("lets an error with a home point at it instead of expanding", () => {
    const onNavigate = () => {};
    const announcement = toErrorAnnouncement({
      headline: "A run failed",
      cause: "boom",
      details: { kind: "navigate", label: "Open run", onNavigate },
    });

    expect(announcement.details).toEqual({
      kind: "navigate",
      label: "Open run",
      onNavigate,
    });
  });
});
