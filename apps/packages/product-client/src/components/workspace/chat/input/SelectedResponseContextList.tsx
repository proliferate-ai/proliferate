import { X } from "#product/primitives/icons/core";
import { MessageSquare } from "#product/primitives/icons/product";
import type { SelectedResponseContext } from "#product/domain/chats/transcript/selected-response-context";
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

  const label = contexts.length === 1
    ? "1 annotation"
    : `${contexts.length} annotations`;

  return (
    <div
      className="flex w-full items-start px-2 pt-2 pb-1"
      data-selected-response-context-list
      data-telemetry-mask
    >
      <div className="flex items-center gap-1.5 rounded-full bg-popover py-[5px] pl-3 pr-1 text-ui-sm text-foreground ring-[0.5px] ring-border">
        <MessageSquare
          aria-hidden="true"
          className="icon-paired shrink-0 text-muted-foreground"
        />
        <span className="tabular-nums">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 shrink-0 rounded-full"
          aria-label="Remove annotations"
          title="Remove annotations"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            for (const context of contexts) {
              onRemove(context.id);
            }
          }}
        >
          <X aria-hidden="true" className="icon-control" />
        </Button>
      </div>
    </div>
  );
}
