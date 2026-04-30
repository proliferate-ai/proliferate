import { useEffect } from "react";
import { applyMacWindowChrome } from "@/platform/tauri/window";

function isTauriDesktop(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

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
  const shouldRender = isTauriDesktop() && isMacPlatform();

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
