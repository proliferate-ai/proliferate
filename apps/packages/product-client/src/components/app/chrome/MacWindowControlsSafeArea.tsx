import { useEffect } from "react";
import { useHasMacWindowControls } from "#product/hooks/ui/layout/use-mac-window-controls";
import { useTauriWindowActions } from "#product/hooks/access/tauri/use-window-actions";

export function MacWindowControlsSafeArea() {
  // Single source of truth for "this host paints macOS window buttons".
  const shouldRender = useHasMacWindowControls();
  const { applyMacWindowChrome } = useTauriWindowActions();

  useEffect(() => {
    if (!shouldRender) {
      return;
    }

    void applyMacWindowChrome().catch(() => {});
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender) {
      return;
    }

    function handleFocus() {
      void applyMacWindowChrome().catch(() => {});
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [shouldRender]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="app-region-no-drag fixed left-0 top-0 z-top h-10 w-[82px]"
      data-tauri-window-controls-safe-area
    />
  );
}
