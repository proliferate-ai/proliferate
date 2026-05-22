import { Fragment, type ComponentProps, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { ListRow } from "@proliferate/ui/layout/ListRow";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { AutomationStatusBadge } from "./AutomationStatusBadge";

interface AutomationRowProps {
  name: ReactNode;
  description?: ReactNode;
  statusLabel: ReactNode;
  statusTone?: ComponentProps<typeof Badge>["tone"];
  runSummary?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}

export function AutomationRow({
  name,
  description,
  statusLabel,
  statusTone,
  runSummary,
  actions,
  onClick,
}: AutomationRowProps) {
  const secondary = renderSeparated([description, runSummary]);
  if (actions) {
    return (
      <div
        className={twMerge(
          "flex w-full items-center gap-3 border-b border-border-light px-4 py-3 text-left last:border-b-0",
          onClick ? "cursor-pointer transition-colors hover:bg-accent" : "",
        )}
        onClick={onClick}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{name}</span>
          {secondary ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <AutomationStatusBadge label={statusLabel} tone={statusTone} />
          {actions}
        </span>
      </div>
    );
  }

  return (
    <ListRow
      title={name}
      description={secondary || undefined}
      trailing={<AutomationStatusBadge label={statusLabel} tone={statusTone} />}
      onClick={onClick}
    />
  );
}

function renderSeparated(items: Array<ReactNode | undefined>): ReactNode {
  const rendered = items.filter(Boolean);
  if (rendered.length === 0) return undefined;
  return rendered.map((item, index) => (
    <Fragment key={index}>
      {index > 0 ? " · " : null}
      {item}
    </Fragment>
  ));
}
