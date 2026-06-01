import type { HTMLAttributes, ReactNode } from "react";

import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";

import type { SidebarActionEvent, SidebarChatRowView } from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";
import { ProductSidebarSectionHeader } from "./ProductSidebarLayout";

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

export interface ProductSidebarThreadRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  active?: boolean;
  status?: ReactNode;
  label: ReactNode;
  subtitle?: string | null;
  detail?: ReactNode;
  trailingLabel?: string | null;
  hoverAction?: ReactNode;
  expandControl?: ReactNode;
  onSelect?: () => void;
}

export function ProductSidebarThreadRow({
  active = false,
  status = null,
  label,
  subtitle = null,
  detail = null,
  trailingLabel = null,
  hoverAction = null,
  expandControl = null,
  onSelect,
  className = "",
  ...props
}: ProductSidebarThreadRowProps) {
  const hasSubtitle = Boolean(subtitle);

  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className={`${hasSubtitle ? "h-[42px]" : "h-[30px]"} pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {hoverAction ? (
        <div className="absolute right-0 top-0 z-10 mr-0.5 flex h-full items-center justify-center pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {hoverAction}
        </div>
      ) : null}
      <div className="flex w-full items-center gap-1.5 text-sm leading-4">
        <div className="flex w-4 shrink-0 items-center justify-center">
          {status}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className={`flex min-w-0 flex-1 ${hasSubtitle ? "flex-col items-start justify-center gap-0.5" : "items-center gap-2"} truncate text-base leading-5 text-sidebar-foreground`}>
            <span className="max-w-full truncate">
              {label}
            </span>
            {hasSubtitle ? (
              <span className="max-w-full truncate text-xs leading-3 text-sidebar-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </div>
          {detail ? (
            <div className="flex min-w-[24px] shrink-0 items-center justify-end gap-1 text-sidebar-muted-foreground">
              {detail}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {trailingLabel && !active && !expandControl ? (
            <div className="truncate text-right text-sm leading-4 tabular-nums text-sidebar-muted-foreground group-focus-within:opacity-0 group-hover:opacity-0">
              {trailingLabel}
            </div>
          ) : null}
          {expandControl}
        </div>
      </div>
    </SidebarRowSurface>
  );
}
