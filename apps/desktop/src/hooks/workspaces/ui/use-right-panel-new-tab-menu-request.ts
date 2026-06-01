import { useEffect, useState } from "react";
import {
  RIGHT_PANEL_NEW_TAB_MENU_EVENT,
  rightPanelNewTabMenuDefaultFromEvent,
  type RightPanelNewTabMenuDefault,
} from "@/lib/infra/right-panel-new-tab-menu";

interface RightPanelNewTabMenuRequest {
  token: number;
  defaultKind: RightPanelNewTabMenuDefault;
}

export function useRightPanelNewTabMenuRequest(): RightPanelNewTabMenuRequest {
  const [request, setRequest] = useState<RightPanelNewTabMenuRequest>({
    token: 0,
    defaultKind: "terminal",
  });

  useEffect(() => {
    const handleNewTabMenuRequest = (event: Event) => {
      setRequest((current) => ({
        token: current.token + 1,
        defaultKind: rightPanelNewTabMenuDefaultFromEvent(event),
      }));
    };

    window.addEventListener(RIGHT_PANEL_NEW_TAB_MENU_EVENT, handleNewTabMenuRequest);
    return () => {
      window.removeEventListener(RIGHT_PANEL_NEW_TAB_MENU_EVENT, handleNewTabMenuRequest);
    };
  }, []);

  return request;
}
