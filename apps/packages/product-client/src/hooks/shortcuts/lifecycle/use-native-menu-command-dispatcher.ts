import { useEffect } from "react";

import type { DesktopNativeUiBridge } from "@proliferate/product-client/host/desktop-bridge";

import { SHORTCUT_REVEAL_RESET_EVENT } from "#product/hooks/shortcuts/lifecycle/use-shortcut-reveal-state";
import { isShortcutId } from "#product/lib/domain/shortcuts/keyboard-resolution";
import { runShortcutHandler } from "#product/lib/domain/shortcuts/registry";

export function useNativeMenuCommandDispatcher(
  subscribeMenuCommands: DesktopNativeUiBridge["subscribeMenuCommands"],
): void {
  useEffect(() => subscribeMenuCommands((id) => {
    if (!isShortcutId(id)) {
      return;
    }

    if (runShortcutHandler(id, { source: "menu" })) {
      window.dispatchEvent(new Event(SHORTCUT_REVEAL_RESET_EVENT));
    }
  }), [subscribeMenuCommands]);
}
