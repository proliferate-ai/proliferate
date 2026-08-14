import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";

export function PopoverSection({
  title,
  detail,
  onHeaderClick,
  headerAriaLabel,
  children,
}: {
  title: string;
  detail?: string | null;
  onHeaderClick?: () => void;
  headerAriaLabel?: string;
  children: ReactNode;
}) {
  const header = (
    <>
      <span className="text-ui font-medium text-foreground">{title}</span>
      {detail ? (
        <span className="shrink-0 text-ui-sm text-muted-foreground">{detail}</span>
      ) : null}
    </>
  );

  return (
    <section>
      {onHeaderClick ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left hover:bg-muted/40"
          aria-label={headerAriaLabel ?? `Open ${title}`}
          onClick={onHeaderClick}
        >
          {header}
        </Button>
      ) : (
        <div className="flex h-7 items-center justify-between gap-2 px-2">
          {header}
        </div>
      )}
      {children}
    </section>
  );
}
