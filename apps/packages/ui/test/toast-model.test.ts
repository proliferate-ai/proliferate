import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_TOAST_DURATION_MS,
  isStatusToast,
  resolveToastDuration,
  STATUS_TOAST_DURATION_MS,
} from "../src/utils/toast-model";

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
    ["modal details", {
      details: { kind: "modal" as const, title: "Details", payload: "a.ts" },
    }],
    ["navigate details", {
      details: { kind: "navigate" as const, onNavigate: noop },
    }],
  ])("keeps an announcement with %s until dismissed", (_name, extra) => {
    expect(
      resolveToastDuration({ weight: "announcement", title: "Choose", ...extra }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps a detail toast with a jump action until dismissed", () => {
    expect(
      resolveToastDuration({
        weight: "detail",
        title: "3 fields need attention",
        payload: "a\nb",
        jump: { label: "Open workflow", onClick: noop },
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
