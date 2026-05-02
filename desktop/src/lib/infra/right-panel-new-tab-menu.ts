export type RightPanelNewTabMenuDefault = "terminal" | "browser";

export const RIGHT_PANEL_NEW_TAB_MENU_EVENT = "proliferate:right-panel-new-tab-menu";

export interface RightPanelNewTabMenuRequest {
  defaultKind: RightPanelNewTabMenuDefault;
}

export function requestRightPanelNewTabMenu(
  defaultKind: RightPanelNewTabMenuDefault = "terminal",
): boolean {
  window.dispatchEvent(new CustomEvent<RightPanelNewTabMenuRequest>(
    RIGHT_PANEL_NEW_TAB_MENU_EVENT,
    { detail: { defaultKind } },
  ));
  return true;
}

export function rightPanelNewTabMenuDefaultFromEvent(
  event: Event,
): RightPanelNewTabMenuDefault {
  if (!(event instanceof CustomEvent)) {
    return "terminal";
  }
  return event.detail?.defaultKind === "browser" ? "browser" : "terminal";
}
