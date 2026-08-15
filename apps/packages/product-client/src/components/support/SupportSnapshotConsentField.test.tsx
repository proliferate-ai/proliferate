// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupportSnapshotConsentField } from "./SupportSnapshotConsentField";
import { SupportSnapshotSaveCopyButton } from "./SupportSnapshotSaveCopyButton";
import type {
  SupportSnapshotConsentState,
} from "#product/hooks/support/workflows/use-support-snapshot-consent";
import {
  SUPPORT_SNAPSHOT_CONSENT_HELPER,
  SUPPORT_SNAPSHOT_CONSENT_LABEL,
} from "#product/lib/domain/support/support-snapshot-consent";

afterEach(cleanup);

function consentState(
  overrides: Partial<SupportSnapshotConsentState> = {},
): SupportSnapshotConsentState {
  return {
    available: true,
    consent: false,
    setConsent: vi.fn(),
    scope: "recent_activity",
    setScope: vi.fn(),
    activeSessionAvailable: true,
    isPreparing: false,
    error: null,
    prepare: vi.fn(async () => ({ state: "none" as const })),
    saveCopy: vi.fn(async () => {}),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe("SupportSnapshotConsentField", () => {
  it("shows the exact disclosure while the box is unchecked", () => {
    render(<SupportSnapshotConsentField snapshot={consentState()} />);

    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(SUPPORT_SNAPSHOT_CONSENT_LABEL)).toBeTruthy();
    expect(screen.getByText(SUPPORT_SNAPSHOT_CONSENT_HELPER)).toBeTruthy();
  });

  it("hides the scope control until consent is given", () => {
    const rendered = render(
      <SupportSnapshotConsentField snapshot={consentState()} />,
    );

    expect(screen.queryByRole("radiogroup")).toBeNull();

    rendered.rerender(
      <SupportSnapshotConsentField snapshot={consentState({ consent: true })} />,
    );

    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Current session" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Recent activity (15 minutes)" })).toBeTruthy();
  });

  it("offers no date or workspace picker", () => {
    render(<SupportSnapshotConsentField snapshot={consentState({ consent: true })} />);

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.querySelector("input[type=\"date\"]")).toBeNull();
  });

  it("keeps Current session unselectable when its mapping is not exact", () => {
    render(
      <SupportSnapshotConsentField
        snapshot={consentState({ consent: true, activeSessionAvailable: false })}
      />,
    );

    const current = screen.getByRole("radio", { name: "Current session" });
    const recent = screen.getByRole("radio", { name: "Recent activity (15 minutes)" });
    expect(current.hasAttribute("disabled")).toBe(true);
    expect(recent.hasAttribute("disabled")).toBe(false);
  });

  it("renders nothing at all on a host without the native coordinator", () => {
    const { container } = render(
      <SupportSnapshotConsentField snapshot={consentState({ available: false })} />,
    );

    expect(container.innerHTML).toBe("");
    expect(screen.queryByText(SUPPORT_SNAPSHOT_CONSENT_LABEL)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("keeps a fatal preparation message visible with consent still checked", () => {
    render(
      <SupportSnapshotConsentField
        snapshot={consentState({ consent: true, error: "Couldn't prepare it." })}
      />,
    );

    expect(screen.getByText("Couldn't prepare it.")).toBeTruthy();
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  });
});

describe("SupportSnapshotSaveCopyButton", () => {
  it("is absent without consent and on a host that cannot prepare", () => {
    const { container, rerender } = render(
      <SupportSnapshotSaveCopyButton snapshot={consentState()} />,
    );
    expect(container.innerHTML).toBe("");

    rerender(
      <SupportSnapshotSaveCopyButton
        snapshot={consentState({ available: false, consent: true })}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("saves a copy from the same live consent", () => {
    const saveCopy = vi.fn(async () => {});
    render(
      <SupportSnapshotSaveCopyButton
        snapshot={consentState({ consent: true, saveCopy })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }));

    expect(saveCopy).toHaveBeenCalledTimes(1);
  });
});
