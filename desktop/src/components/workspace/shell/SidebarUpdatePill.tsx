import { Button } from "@/components/ui/Button";
import { ArrowUp, Check, LoaderCircle } from "@/components/ui/icons";
import type { UpdaterPhase } from "@/hooks/updater/use-updater";

interface SidebarUpdatePillProps {
  phase: UpdaterPhase;
  onDownloadUpdate: () => void | Promise<void>;
  onOpenRestartPrompt: () => void;
}

export function SidebarUpdatePill({
  phase,
  onDownloadUpdate,
  onOpenRestartPrompt,
}: SidebarUpdatePillProps) {
  const show = phase === "available" || phase === "downloading" || phase === "ready";
  if (!show) {
    return null;
  }

  const icon =
    phase === "downloading"
      ? <LoaderCircle className="size-3.5 animate-spin" />
      : phase === "ready"
        ? <Check className="size-3.5" />
        : <ArrowUp className="size-3.5" />;

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
      onClick={handleClick}
      disabled={phase === "downloading"}
      className="!h-7 !justify-start rounded-lg border border-border bg-secondary px-2.5 text-left text-secondary-foreground shadow-none transition-colors hover:bg-secondary/80 hover:text-secondary-foreground"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-secondary-foreground">
        {icon}
      </span>
      <span className="min-w-0 truncate text-[12px] font-normal text-secondary-foreground">
        Update
      </span>
    </Button>
  );
}
