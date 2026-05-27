import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { IconButton } from "@proliferate/ui/primitives/IconButton";

import { SettingsScreen } from "../components/settings/screen/SettingsScreen";
import { routes } from "../config/routes";

type SettingsRouteState = {
  backgroundLocation?: unknown;
};

export function SettingsModalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const hasBackground = Boolean((location.state as SettingsRouteState | null)?.backgroundLocation);

  const closeSettings = useCallback(() => {
    if (hasBackground) {
      navigate(-1);
      return;
    }
    navigate(routes.home, { replace: true });
  }, [hasBackground, navigate]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSettings();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSettings]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/48 p-4 backdrop-blur-[2px]"
      data-telemetry-block
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="relative h-[min(820px,calc(100vh-2rem))] w-[min(1120px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none"
      >
        <IconButton
          title="Close settings"
          aria-label="Close settings"
          onClick={closeSettings}
          className="absolute right-3 top-3 z-10 bg-background/80"
        >
          <X size={16} />
        </IconButton>
        <SettingsScreen />
      </div>
    </div>
  );
}
