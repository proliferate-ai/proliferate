export type RightPanelNewTabMenuDefault = "terminal";

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
  _event: Event,
): RightPanelNewTabMenuDefault {
  return "terminal";
}
