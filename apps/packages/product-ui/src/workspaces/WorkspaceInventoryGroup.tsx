import { useId } from "react";
import { twMerge } from "tailwind-merge";
import { ChevronRight } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";
import type { WorkspaceInventoryGroupView } from "@proliferate/product-domain/workspaces/inventory";

import { InventoryRow } from "./WorkspaceInventoryRow";
import { StatusGlyph } from "./WorkspaceInventoryGlyphs";

export function InventoryGroup({
  group,
  externalOpenWorkspaceIds,
  onGroupToggle,
  onWorkspaceSelect,
}: {
  group: WorkspaceInventoryGroupView;
  externalOpenWorkspaceIds?: ReadonlySet<string>;
  onGroupToggle?: (groupId: string) => void;
  onWorkspaceSelect?: (workspaceId: string) => void;
}) {
  const headingId = useId();
  const listId = useId();
  const canToggle = typeof onGroupToggle === "function";
  const collapsed = canToggle && Boolean(group.collapsed);

  const headerContent = (
    <>
      <span
        className={twMerge(
          "flex min-w-0 items-center gap-2",
          canToggle ? "" : "pl-0.5",
        )}
      >
        {canToggle && (
          <ChevronRight
            className={twMerge(
              "size-4 shrink-0 text-muted-foreground/36 transition-transform",
              collapsed ? "" : "rotate-90",
            )}
            aria-hidden
          />
        )}
        {group.statusKind && <StatusGlyph status={group.statusKind} size={14} />}
        <span
          id={headingId}
          className="text-sm font-medium leading-5 text-foreground"
        >
          {group.label}
        </span>
      </span>
      <span className="text-sm tabular-nums text-muted-foreground">
        {group.count}
      </span>
    </>
  );

  const headerClass =
    "group mt-3 flex h-9 w-full justify-start items-center gap-2 rounded-[10px] bg-foreground/[0.042] px-3";

  return (
    <section aria-labelledby={headingId}>
      {canToggle ? (
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          onClick={() => onGroupToggle(group.id)}
          aria-controls={listId}
          aria-expanded={!collapsed}
          className={twMerge(
            headerClass,
            "cursor-pointer hover:bg-foreground/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]",
          )}
        >
          {headerContent}
        </Button>
      ) : (
        <div className={headerClass}>{headerContent}</div>
      )}

      <div id={listId} hidden={collapsed}>
        {!collapsed &&
          (group.items.length > 0 ? (
            group.items.map((item) => (
              <InventoryRow
                key={item.id}
                item={item}
                suppressSourceLabel={group.id === item.sourceKind}
                suppressOwnerLabel={Boolean(group.suppressOwnerLabel)}
                showExternalOpenAction={externalOpenWorkspaceIds?.has(item.id) ?? false}
                onWorkspaceSelect={onWorkspaceSelect}
              />
            ))
          ) : (
            <div className="px-2.5 py-2 text-xs text-muted-foreground/50">
              No workspaces
            </div>
          ))}
      </div>
    </section>
  );
}
