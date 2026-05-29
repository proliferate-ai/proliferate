import { Fragment, type ComponentProps, type ReactNode } from "react";
import { ListRow } from "@proliferate/ui/layout/ListRow";
import { Badge } from "@proliferate/ui/primitives/Badge";

interface WorkspaceRowProps {
  name: ReactNode;
  repoLabel?: ReactNode;
  branchLabel?: ReactNode;
  kindLabel?: ReactNode;
  kindTone?: ComponentProps<typeof Badge>["tone"];
  onClick?: () => void;
}

export function WorkspaceRow({
  name,
  repoLabel,
  branchLabel,
  kindLabel,
  kindTone = "neutral",
  onClick,
}: WorkspaceRowProps) {
  const description = renderSeparated([repoLabel, branchLabel]);
  return (
    <ListRow
      title={name}
      description={description || undefined}
      trailing={kindLabel ? <Badge tone={kindTone}>{kindLabel}</Badge> : undefined}
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
