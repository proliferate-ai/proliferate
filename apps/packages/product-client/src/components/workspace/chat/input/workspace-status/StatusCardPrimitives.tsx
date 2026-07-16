import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Check, CircleAlert, Circle, Spinner } from "@proliferate/ui/icons";
import {
  Tooltip as KitTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@proliferate/ui/kit/Tooltip";

/**
 * The codex card anatomy (reference/codex/status/card.html), extracted from
 * the workspace-status card so every composer ambient surface — status card,
 * environment popover — shares one section/row recipe.
 */

export type WorkspaceStatusDetailState =
  | "failing"
  | "pending"
  | "passing"
  | "working"
  | "done";

export interface WorkspaceStatusDetailItem {
  key: string;
  name: string;
  state?: WorkspaceStatusDetailState;
  detail?: string;
  meta?: string;
}

/* Codex section anatomy (card.html): hairline via ::after inset-x-4,
   sticky h-7 header in card background, rows in a gap-0.5 px-4 column. */
export function StatusSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="relative z-0 flex flex-col pb-3 after:absolute after:inset-x-4 after:bottom-0 after:h-[0.5px] after:bg-border after:content-[''] last:pb-0 last:after:hidden">
      <header className="sticky top-0 z-10 flex h-7 w-full min-w-0 items-center justify-start gap-2 bg-popover ps-4 pe-2.5 pb-0.5 text-ui text-muted-foreground">
        <span className="truncate">{title}</span>
        {detail ? <span className="ms-auto shrink-0 text-ui-sm text-faint">{detail}</span> : null}
      </header>
      <div className="mt-0.5 flex flex-col gap-0.5 px-4">{children}</div>
    </section>
  );
}

/* Codex row recipe (group/summary-panel-row): h-7, icon in a fixed slot,
   truncating label, trailing meta, full-row hover paint via ::before that
   outsets 8px past the row box. */
const STATUS_ROW_CLASS =
  "group/status-row relative isolate flex h-7 w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-ui text-foreground before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-md before:content-['']";

export function StatusRow({
  icon,
  leading,
  label,
  meta,
  trailing,
  hoverItems,
  onSelect,
  disabled = false,
  title,
}: {
  icon?: ReactNode;
  /** Replaces the fixed-width icon slot — for codex avatar-group clusters. */
  leading?: ReactNode;
  label: string;
  meta?: string;
  trailing?: ReactNode;
  hoverItems?: WorkspaceStatusDetailItem[];
  onSelect?: () => void;
  /** Codex cmdk disabled recipe: dimmed, no hover paint, no action. */
  disabled?: boolean;
  title?: string;
}) {
  const body = (
    <>
      {leading ?? (
        <span className="flex w-[18px] shrink-0 items-center justify-start text-muted-foreground">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className="shrink-0 text-ui-sm text-muted-foreground">{meta}</span> : null}
      {trailing}
    </>
  );

  if (disabled) {
    return <div className={`${STATUS_ROW_CLASS} opacity-25`}>{body}</div>;
  }

  // Only rows with their own action render as a <button>; rows whose only
  // affordance lives in `trailing` stay a <div> so a trailing action button
  // doesn't nest inside another button (invalid DOM, unreliable clicks).
  const interactive = !!onSelect;
  const row = interactive
    ? (
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        title={title}
        onClick={onSelect}
        className={`${STATUS_ROW_CLASS} cursor-pointer hover:before:bg-list-hover`}
      >
        {body}
      </Button>
    )
    : <div className={`${STATUS_ROW_CLASS} hover:before:bg-list-hover`}>{body}</div>;

  if (!hoverItems || hoverItems.length === 0) {
    return row;
  }

  /* Leaf detail on hover, codex tooltip recipe (tooltip1.html): rounded-xl,
     translucent popover bg, 0.5px ring, backdrop blur; radix-portaled so the
     card's scroll container can't clip it; opens leftward over the
     transcript — the free side next to a right-anchored card. */
  return (
    <TooltipProvider delayDuration={150}>
      <KitTooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent
          side="left"
          sideOffset={14}
          collisionPadding={12}
          className="pointer-events-none flex w-80 flex-col rounded-xl bg-popover/90 p-0 py-1 font-normal shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm"
        >
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-3">
            {hoverItems.map((item) => (
              <div key={item.key} className="flex min-w-0 items-start gap-2 py-1.5">
                <span className="flex h-4 w-[18px] shrink-0 items-center justify-start">
                  <DetailStateGlyph state={item.state} emphasizeFailing />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-ui text-foreground">{item.name}</span>
                  {item.detail ? (
                    <span className="line-clamp-2 text-ui-sm leading-4 text-muted-foreground">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
                {item.meta ? (
                  <span className="shrink-0 text-ui-sm text-faint">{item.meta}</span>
                ) : null}
              </div>
            ))}
          </div>
        </TooltipContent>
      </KitTooltip>
    </TooltipProvider>
  );
}

export function DetailStateGlyph({
  state,
  emphasizeFailing = false,
}: {
  state?: WorkspaceStatusDetailState;
  emphasizeFailing?: boolean;
}) {
  if (state === "failing") {
    return (
      <CircleAlert
        className={`size-4 ${emphasizeFailing ? "text-destructive" : "text-muted-foreground"}`}
      />
    );
  }
  if (state === "working") {
    return <Spinner className="size-3.5 text-muted-foreground" />;
  }
  if (state === "pending") {
    return <Circle className="size-3.5 text-muted-foreground" />;
  }
  if (state === "passing" || state === "done") {
    return <Check className="size-3.5 text-muted-foreground" />;
  }
  return null;
}
