import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

/**
 * The small icon-only action button shared by the goal bar's live controls
 * (pause/edit/delete/dismiss) and its objective editor (commit/cancel).
 */
export function GoalBarIconAction({
  label,
  icon,
  onClick,
  inert = false,
  destructive = false,
  positive = false,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  /**
   * Render disabled-looking but still focusable (aria-disabled, click blocked)
   * rather than natively `disabled` — a native-disabled button leaves the tab
   * order, which would hide a wrapping tooltip from keyboard/AT users.
   */
  inert?: boolean;
  destructive?: boolean;
  positive?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-disabled={inert || undefined}
      onClick={inert ? undefined : onClick}
      aria-label={label}
      title={inert ? undefined : label}
      className={twMerge(
        "h-6 w-6 text-muted-foreground hover:text-foreground",
        destructive && "hover:text-destructive",
        positive && "hover:text-success",
        inert && "cursor-default opacity-50 hover:text-muted-foreground",
      )}
    >
      {icon}
    </Button>
  );
}
