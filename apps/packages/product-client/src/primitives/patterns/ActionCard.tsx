import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";

export interface ActionCardProps {
  leading: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  secondaryAction?: ReactNode;
  actionLabel: string;
  loading?: boolean;
  onAction: () => void;
}

/**
 * A compact pressable card with a full-card primary button and independent
 * accessory and secondary-action slots. The overlay button stays a sibling of
 * every secondary control, so the actions never nest or share activation.
 */
export function ActionCard({
  leading,
  title,
  description,
  trailing,
  secondaryAction,
  actionLabel,
  loading = false,
  onAction,
}: ActionCardProps) {
  return (
    <div className="group relative flex min-h-26 min-w-0 flex-col rounded-composer bg-background px-4 py-3 text-left shadow-subtle ring-[0.5px] ring-border-heavy zoom-stable-hairline-frame transition-colors hover:bg-hover active:bg-active">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        loading={loading}
        aria-label={actionLabel}
        onClick={onAction}
        className="absolute inset-0 z-base rounded-composer"
      />
      <span
        className={`pointer-events-none z-raised flex items-center gap-1.5 ${secondaryAction ? "pr-9" : ""}`}
      >
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground [&_svg]:icon-control"
        >
          {leading}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {trailing}
        </span>
      </span>
      {secondaryAction ? (
        <span className="absolute right-2 top-2 z-sticky">
          {secondaryAction}
        </span>
      ) : null}
      <span className="pointer-events-none z-raised mt-auto flex min-h-10 min-w-0 flex-col justify-end gap-0.5">
        <span
          className={`${description ? "truncate" : "line-clamp-2"} text-body font-medium text-foreground`}
        >
          {title}
        </span>
        {description ? (
          <span className="line-clamp-2 text-ui-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
