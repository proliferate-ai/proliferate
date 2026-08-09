import { Quote, X } from "lucide-react";
import type { SelectedResponseContext } from "#product/domain/chats/transcript/selected-response-context";
import { selectedResponseContextPreview } from "#product/domain/chats/transcript/selected-response-context";
import { Button } from "#product/primitives/Button";

export function SelectedResponseContextList({
  contexts,
  onRemove,
}: {
  contexts: readonly SelectedResponseContext[];
  onRemove: (id: string) => void;
}) {
  if (contexts.length === 0) {
    return null;
  }

  return (
    <div
      className="flex w-full flex-col gap-1.5 px-2 pt-2 pb-1"
      data-selected-response-context-list
      data-telemetry-mask
    >
      {contexts.map((context) => (
        <div
          key={context.id}
          className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-foreground"
        >
          <Quote
            aria-hidden="true"
            className="mt-0.5 icon-paired shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <div className="text-ui-sm font-medium text-foreground">Response excerpt</div>
            <div className="line-clamp-2 text-ui-sm text-muted-foreground">
              {selectedResponseContextPreview(context.text)}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mr-1 -mt-1 size-6 shrink-0 rounded-md"
            aria-label="Remove response excerpt"
            title="Remove response excerpt"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onRemove(context.id)}
          >
            <X aria-hidden="true" className="icon-control" />
          </Button>
        </div>
      ))}
    </div>
  );
}
