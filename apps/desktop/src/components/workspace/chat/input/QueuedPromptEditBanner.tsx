import { Button } from "@proliferate/ui/primitives/Button";

interface QueuedPromptEditBannerProps {
  onCancel: () => void;
}

// Companion to the queue's "Editing…" row state: a quiet control-surface
// notice above the composer while a queued message is loaded for editing.
export function QueuedPromptEditBanner({ onCancel }: QueuedPromptEditBannerProps) {
  return (
    <div className="mx-5 mt-3 flex items-center justify-between gap-2 rounded-lg bg-surface-control px-2.5 py-1 text-ui-sm leading-[var(--text-ui-sm--line-height)] text-muted-foreground">
      <span>Editing queued message</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="h-6 px-2 text-ui-sm text-muted-foreground hover:text-foreground"
      >
        Cancel
      </Button>
    </div>
  );
}
