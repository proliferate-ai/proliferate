import type { SidebarActionEvent, SidebarChatRowView } from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";
import { ProductSidebarSectionHeader } from "./ProductSidebarLayout";
import { ProductSidebarThreadRow } from "./ProductSidebarThreads";

export function ProductSidebarThreadSection({
  rows,
  onChatSelect,
  onAction,
}: {
  rows: SidebarChatRowView[];
  onChatSelect?: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <section className="pb-2">
      <ProductSidebarSectionHeader label="Threads" />
      <div className="flex flex-col gap-px">
        {rows.map((row) => (
          <ChatRow
            key={row.id}
            row={row}
            onSelect={onChatSelect}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}

function ChatRow({
  row,
  onSelect,
  onAction,
}: {
  row: SidebarChatRowView;
  onSelect?: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
}) {
  const hoverAction = (row.actions ?? []).slice(0, 1).map((action) => (
    <SidebarActionIconButton
      key={action.id}
      action={action}
      scope="chat"
      itemId={row.id}
      onAction={onAction}
      alwaysVisible
    />
  ));

  return (
    <ProductSidebarThreadRow
      active={Boolean(row.active)}
      status={row.status}
      label={row.label}
      subtitle={row.subtitle}
      detail={row.detail}
      trailingLabel={row.trailingLabel}
      hoverAction={hoverAction.length > 0 ? hoverAction : null}
      onSelect={() => onSelect?.(row.id)}
    />
  );
}
