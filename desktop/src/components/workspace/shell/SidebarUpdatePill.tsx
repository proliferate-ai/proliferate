import { Button } from "@/components/ui/Button";
import { Check, LoaderCircle } from "@/components/ui/icons";
import type { UpdaterPhase } from "@/hooks/updater/use-updater";

interface SidebarUpdatePillProps {
  phase: UpdaterPhase;
  downloadProgress?: number | null;
  onDownloadUpdate: () => void | Promise<void>;
  onOpenRestartPrompt: () => void;
}

export function SidebarUpdatePill({
  phase,
  downloadProgress = null,
  onDownloadUpdate,
  onOpenRestartPrompt,
}: SidebarUpdatePillProps) {
  const show = phase === "available" || phase === "downloading" || phase === "ready";
  if (!show) {
    return null;
  }

  const label =
    phase === "downloading"
      ? typeof downloadProgress === "number"
        ? `Downloading ${downloadProgress}%`
        : "Downloading"
      : phase === "ready"
        ? "Restart"
        : "Update available";

  const compactLabel =
    phase === "downloading"
      ? typeof downloadProgress === "number"
        ? `${downloadProgress}%`
        : ""
      : phase === "ready"
        ? "Restart"
        : "Update";

  const indicator =
    phase === "downloading"
      ? <LoaderCircle className="size-3 animate-spin text-sidebar-muted-foreground" />
      : phase === "ready"
        ? <Check className="size-3 text-info-foreground" />
        : null;

  const actionClassName =
    "border-transparent bg-info text-info-foreground hover:bg-info/90 active:bg-info/80";
  const pillClassName =
    phase === "ready"
      ? actionClassName
      : phase === "downloading"
        ? "cursor-default border-sidebar-border/50 bg-sidebar-accent/60 text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-muted-foreground"
        : actionClassName;

  function handleClick() {
    if (phase === "available") {
      void onDownloadUpdate();
      return;
    }

    if (phase === "ready") {
      onOpenRestartPrompt();
    }
  }

  return (
    <Button
      variant="ghost"
      size="md"
      aria-label={label}
      title={label}
      onClick={handleClick}
      disabled={phase === "downloading"}
      className={`h-5 min-w-5 max-w-24 justify-center gap-1 overflow-hidden rounded-full border px-2 py-0 text-[10px] font-semibold leading-none shadow-none transition-[background-color,border-color,color] duration-150 disabled:pointer-events-auto disabled:opacity-100 ${pillClassName}`}
    >
      {indicator && (
        <span className="flex size-3 shrink-0 items-center justify-center">
          {indicator}
        </span>
      )}
      {compactLabel && <span className="min-w-0 truncate">{compactLabel}</span>}
    </Button>
  );
}
