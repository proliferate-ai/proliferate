import { useId } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
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
              "icon-paired shrink-0 text-muted-foreground/36 transition-transform",
              collapsed ? "" : "rotate-90",
            )}
            aria-hidden
          />
        )}
        {group.statusKind && <StatusGlyph status={group.statusKind} className="icon-paired" />}
        <span
          id={headingId}
          className="text-heading font-medium text-foreground"
        >
          {group.label}
        </span>
      </span>
      <span className="text-ui-sm tabular-nums text-muted-foreground">
        {group.count}
      </span>
    </>
  );

  const headerClass =
    "group mt-3 flex h-9 w-full justify-start items-center gap-2 rounded-sm bg-surface-elevated-secondary px-3 text-heading";

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
            "cursor-pointer hover:bg-hover active:bg-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]",
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
            <div className="px-2.5 py-2 text-ui-sm text-muted-foreground/50">
              No workspaces
            </div>
          ))}
      </div>
    </section>
  );
}
