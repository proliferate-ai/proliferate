import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

/**
 * `framed` is the chrome page header: a bordered, padded band that separates
 * itself from the content below. `flat` is the settings-pane look — no rule,
 * no padding, tighter tracking, smaller description.
 */
export type PageHeaderVariant = "framed" | "flat";

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  action?: ReactNode;
  variant?: PageHeaderVariant;
}

const VARIANT_CLASSES: Record<
  PageHeaderVariant,
  { root: string; heading: string; title: string; description: string; actions: string }
> = {
  framed: {
    root: "flex min-w-0 flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5",
    heading: "min-w-0",
    /* ui-foundation-escalation: page-title role resolved to text-title
       (19px/24px), the closed ramp's largest heading rung, matching
       origin/ui-foundation-pass's prior-art choice for this component.
       This is a visible ~12px shrink from the pre-migration 31px/34px
       calc() literal (itself anchored on the now-deleted --text-xl
       ladder) — flagged for founder review at the checkpoint rather
       than silently absorbed, since no enumerated retune specifically
       authorizes a page-title rung. */
    title: "text-title font-semibold tracking-normal text-foreground",
    description: "mt-1 max-w-3xl text-body text-muted-foreground",
    actions: "flex shrink-0 items-center gap-2",
  },
  flat: {
    root: "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
    heading: "min-w-0 space-y-1",
    title: "text-title font-semibold tracking-[-0.012em] text-foreground",
    description: "max-w-2xl text-ui-sm text-muted-foreground",
    actions: "flex shrink-0 items-center",
  },
};

export function PageHeader({
  title,
  description,
  actions,
  action,
  variant = "framed",
  className = "",
  ...props
}: PageHeaderProps) {
  const renderedActions = actions ?? action;
  const classes = VARIANT_CLASSES[variant];

  const body = (
    <>
      <div className={classes.heading}>
        <h1 className={classes.title}>{title}</h1>
        {description && <p className={classes.description}>{description}</p>}
      </div>
      {renderedActions ? <div className={classes.actions}>{renderedActions}</div> : null}
    </>
  );

  if (variant === "flat") {
    return (
      <header className={twMerge(classes.root, className)} {...props}>
        {body}
      </header>
    );
  }

  return (
    <div className={twMerge(classes.root, className)} {...props}>
      {body}
    </div>
  );
}
