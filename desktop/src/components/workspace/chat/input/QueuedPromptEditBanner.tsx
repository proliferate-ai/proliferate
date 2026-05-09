import { Button } from "@/components/ui/Button";

interface QueuedPromptEditBannerProps {
  onCancel: () => void;
}

export function QueuedPromptEditBanner({ onCancel }: QueuedPromptEditBannerProps) {
  return (
    <div className="mx-5 mt-3 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
      <span>Editing queued message</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="h-6 px-2 text-xs"
      >
        Cancel
      </Button>
    </div>
  );
}
