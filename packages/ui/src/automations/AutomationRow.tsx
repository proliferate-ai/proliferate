import { type ReactNode } from "react";
import { ListRow } from "../layout/ListRow";
import { AutomationStatusBadge } from "./AutomationStatusBadge";

interface AutomationRowProps {
  name: ReactNode;
  description?: ReactNode;
  status: "enabled" | "paused" | "failed";
  runSummary?: ReactNode;
  onClick?: () => void;
}

export function AutomationRow({
  name,
  description,
  status,
  runSummary,
  onClick,
}: AutomationRowProps) {
  const secondary = [description, runSummary].filter(Boolean).join(" · ");
  return (
    <ListRow
      title={name}
      description={secondary || undefined}
      trailing={<AutomationStatusBadge status={status} />}
      onClick={onClick}
    />
  );
}
