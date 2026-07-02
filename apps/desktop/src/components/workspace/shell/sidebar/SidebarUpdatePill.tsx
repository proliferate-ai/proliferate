import { Button } from "@proliferate/ui/primitives/Button";
import { Spinner } from "@proliferate/ui/icons";
import type { UpdaterPhase } from "@/hooks/access/tauri/use-updater";

interface SidebarUpdatePillProps {
  phase: UpdaterPhase;
  // Accepted for compatibility with the shells that render the pill; the pill itself no
  // longer surfaces a percentage (the spinner conveys progress).
  downloadProgress?: number | null;
  // True when "restart when they finish" is armed. The shells thread the state today;
  // the pill's armed visuals ship separately. Omitted reads as false.
  restartWhenIdle?: boolean;
  onDownloadUpdate: () => void | Promise<void>;
  onOpenRestartPrompt: () => void;
}

export function SidebarUpdatePill({
  phase,
  onDownloadUpdate,
  onOpenRestartPrompt,
}: SidebarUpdatePillProps) {
  if (phase !== "available" && phase !== "downloading" && phase !== "ready") {
    return null;
  }

  const isDownloading = phase === "downloading";
  const label =
    phase === "available"
      ? "Download Update"
      : isDownloading
        ? "Downloading update"
        : "Update";

  function handleClick() {
    if (phase === "available") {
      void onDownloadUpdate();
      return;
    }
    if (phase === "ready") {
      onOpenRestartPrompt();
    }
  }

  // UX spec §12: 12px, --special text, pill on --accent.
  const toneClass = isDownloading
    ? "cursor-default bg-accent text-muted-foreground"
    : "bg-accent text-special hover:bg-foreground/10";

  return (
    <Button
      variant="unstyled"
      size="unstyled"
      aria-label={label}
      title={label}
      onClick={handleClick}
      disabled={isDownloading}
      className={`flex h-6 max-w-44 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium leading-none transition-colors disabled:opacity-100 ${toneClass}`}
    >
      {isDownloading && <Spinner className="size-3 shrink-0" />}
      <span className="truncate">{label}</span>
    </Button>
  );
}
