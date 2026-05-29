import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

import { IconButton } from "@proliferate/ui/primitives/IconButton";

import { SettingsScreen } from "../components/settings/screen/SettingsScreen";
import { routes } from "../config/routes";

type SettingsRouteState = {
  backgroundLocation?: Pick<Location, "pathname" | "search" | "hash">;
};

export function SettingsModalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const backgroundLocation = (location.state as SettingsRouteState | null)?.backgroundLocation;
  const backgroundPath = backgroundLocation
    ? `${backgroundLocation.pathname}${backgroundLocation.search}${backgroundLocation.hash}`
    : null;

  const closeSettings = useCallback(() => {
    if (backgroundPath) {
      navigate(backgroundPath, { replace: true });
      return;
    }
    navigate(routes.home, { replace: true });
  }, [backgroundPath, navigate]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/48 p-3 backdrop-blur-[2px] sm:p-5"
      data-telemetry-block
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeSettings();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="relative h-[min(880px,calc(100vh-1.5rem))] w-[min(1180px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl outline-none"
      >
        <IconButton
          title="Close settings"
          aria-label="Close settings"
          onClick={closeSettings}
          className="absolute right-3 top-3 z-10 border border-border bg-background/90 shadow-sm"
        >
          <X size={16} />
        </IconButton>
        <SettingsScreen />
      </div>
    </div>
  );
}
