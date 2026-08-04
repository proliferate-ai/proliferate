import { useEffect } from "react";
import { focusChatInputOnActivation } from "#product/lib/domain/focus-zone";

/**
 * Refocuses the visible chat composer whenever the app window becomes active
 * again, so typing works immediately after switching back to the app. Focus
 * ownership rules (never stealing from another surface) live in
 * `focusChatInputOnActivation`. Mounted on Desktop only.
 */
export function useComposerActivationFocus(): void {
  useEffect(() => {
    const handleWindowFocus = () => {
      focusChatInputOnActivation();
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, []);
}
