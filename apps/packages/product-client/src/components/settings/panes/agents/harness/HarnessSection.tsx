import { type ReactNode } from "react";

/**
 * Sentence-case section shell for the harness pane's v2 sections
 * (design-handoff README "Authentication section"): a 13/20 weight-590 title
 * (NOT the mono eyebrow), a muted one-line description, and a right-aligned
 * action cluster — where the merged status badge + refresh live, so the state
 * is said exactly once, in the header.
 */
export function HarnessSection({
  title,
  description,
  action,
  children,
  className,
  ...props
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section className={className} {...props}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-body font-[590] tracking-[-0.005em] text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-ui text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">{action}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
