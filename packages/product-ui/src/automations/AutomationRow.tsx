import { Fragment, type ComponentProps, type ReactNode } from "react";
import { ListRow } from "@proliferate/ui/layout/ListRow";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { AutomationStatusBadge } from "./AutomationStatusBadge";

interface AutomationRowProps {
  name: ReactNode;
  description?: ReactNode;
  statusLabel: ReactNode;
  statusTone?: ComponentProps<typeof Badge>["tone"];
  runSummary?: ReactNode;
  onClick?: () => void;
}

export function AutomationRow({
  name,
  description,
  statusLabel,
  statusTone,
  runSummary,
  onClick,
}: AutomationRowProps) {
  const secondary = renderSeparated([description, runSummary]);
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
