import { useEffect } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useTauriWindowActions } from "#product/hooks/access/tauri/use-window-actions";

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? navigator.platform;
  return /\bmac/i.test(platform);
}

export function MacWindowControlsSafeArea() {
  // `host.desktop !== null` is the same distinction the raw `__TAURI_INTERNALS__`
  // probe made pre-move: a native Desktop host with window chrome to inset.
  const isDesktop = useProductHost().desktop !== null;
  const shouldRender = isDesktop && isMacPlatform();
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
      className="app-region-no-drag fixed left-0 top-0 z-[2147483647] h-10 w-[82px]"
      data-tauri-window-controls-safe-area
    />
  );
}
