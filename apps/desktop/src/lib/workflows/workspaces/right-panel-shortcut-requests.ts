import type { ShortcutDigit } from "@/lib/domain/shortcuts/matching";

export const RIGHT_PANEL_SHORTCUT_EVENT = "proliferate:right-panel-shortcut";

export type RightPanelShortcutRequest =
  | { kind: "close-active-tab" }
  | { kind: "relative-tab"; delta: -1 | 1 }
  | { kind: "tab-by-index"; digit: ShortcutDigit };

export function requestRightPanelCloseActiveTab(): boolean {
  return dispatchRightPanelShortcutRequest({ kind: "close-active-tab" });
}

export function requestRightPanelRelativeTab(delta: -1 | 1): boolean {
  return dispatchRightPanelShortcutRequest({ kind: "relative-tab", delta });
}

export function requestRightPanelTabByIndex(digit: ShortcutDigit): boolean {
  return dispatchRightPanelShortcutRequest({ kind: "tab-by-index", digit });
}

export function rightPanelShortcutRequestFromEvent(
  event: Event,
): RightPanelShortcutRequest | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const detail = event.detail as Partial<RightPanelShortcutRequest> | undefined;
  if (detail?.kind === "close-active-tab") {
    return { kind: "close-active-tab" };
  }

  if (detail?.kind === "relative-tab") {
    return detail.delta === -1 || detail.delta === 1
      ? { kind: "relative-tab", delta: detail.delta }
      : null;
  }

  if (detail?.kind === "tab-by-index") {
    return isShortcutDigit(detail.digit)
      ? { kind: "tab-by-index", digit: detail.digit }
      : null;
  }

  return null;
}

function isShortcutDigit(value: unknown): value is ShortcutDigit {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 1
    && value <= 9;
}

function dispatchRightPanelShortcutRequest(request: RightPanelShortcutRequest): boolean {
  const event = new CustomEvent<RightPanelShortcutRequest>(
    RIGHT_PANEL_SHORTCUT_EVENT,
    {
      cancelable: true,
      detail: request,
    },
  );
  return !window.dispatchEvent(event);
}
