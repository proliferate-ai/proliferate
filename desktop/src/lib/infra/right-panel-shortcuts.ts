import type { ShortcutDigit } from "@/lib/domain/shortcuts/matching";

export const RIGHT_PANEL_SHORTCUT_EVENT = "proliferate:right-panel-shortcut";

export type RightPanelShortcutRequest =
  | { kind: "relative-tab"; delta: -1 | 1 }
  | { kind: "tab-by-index"; digit: ShortcutDigit };

export function requestRightPanelRelativeTab(delta: -1 | 1): boolean {
  window.dispatchEvent(new CustomEvent<RightPanelShortcutRequest>(
    RIGHT_PANEL_SHORTCUT_EVENT,
    { detail: { kind: "relative-tab", delta } },
  ));
  return true;
}

export function requestRightPanelTabByIndex(digit: ShortcutDigit): boolean {
  window.dispatchEvent(new CustomEvent<RightPanelShortcutRequest>(
    RIGHT_PANEL_SHORTCUT_EVENT,
    { detail: { kind: "tab-by-index", digit } },
  ));
  return true;
}

export function rightPanelShortcutRequestFromEvent(
  event: Event,
): RightPanelShortcutRequest | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const detail = event.detail as Partial<RightPanelShortcutRequest> | undefined;
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
