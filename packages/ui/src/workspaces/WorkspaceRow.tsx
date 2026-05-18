import { type ReactNode } from "react";
import { Badge } from "../primitives/Badge";
import { ListRow } from "../layout/ListRow";

interface WorkspaceRowProps {
  name: ReactNode;
  repoLabel?: ReactNode;
  branchLabel?: ReactNode;
  shared?: boolean;
  onClick?: () => void;
}

export function WorkspaceRow({
  name,
  repoLabel,
  branchLabel,
  shared = false,
  onClick,
}: WorkspaceRowProps) {
  const description = [repoLabel, branchLabel].filter(Boolean).join(" · ");
  return (
    <ListRow
      title={name}
      description={description || undefined}
      trailing={<Badge tone={shared ? "info" : "neutral"}>{shared ? "Team" : "Personal"}</Badge>}
      onClick={onClick}
    />
  );
}
