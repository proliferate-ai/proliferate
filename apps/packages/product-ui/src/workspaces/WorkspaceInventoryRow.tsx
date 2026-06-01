import { twMerge } from "tailwind-merge";
import { ExternalLink } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";
import type { WorkspaceInventoryItemView } from "@proliferate/product-domain/workspaces/inventory";

import { SourceGlyph } from "./WorkspaceInventoryGlyphs";

export function InventoryRow({
  item,
  suppressSourceLabel,
  suppressOwnerLabel,
  showExternalOpenAction,
  onWorkspaceSelect,
}: {
  item: WorkspaceInventoryItemView;
  suppressSourceLabel: boolean;
  suppressOwnerLabel: boolean;
  showExternalOpenAction: boolean;
  onWorkspaceSelect?: (workspaceId: string) => void;
}) {
  const hasAction = typeof onWorkspaceSelect === "function";
  const ariaLabel = buildRowAriaLabel(item, showExternalOpenAction);
  const targetLabel = [item.runtimeLocationLabel, item.cloudAccessLabel].filter(Boolean).join(" · ");
  const subtitle = rowSubtitle(item);

  const rowClass = twMerge(
    "group relative grid h-12 w-full grid-cols-[18px_minmax(0,1fr)_3.5rem] items-center gap-x-3 rounded-[5px] px-3 py-1 text-left",
    suppressSourceLabel
      ? "sm:grid-cols-[18px_7.5rem_minmax(0,1fr)_3.5rem] lg:grid-cols-[18px_7.5rem_minmax(0,1fr)_minmax(8rem,14rem)_6.75rem_3.5rem]"
      : "sm:grid-cols-[18px_5.5rem_minmax(0,1fr)_3.5rem] md:grid-cols-[18px_5.5rem_7.5rem_minmax(0,1fr)_3.5rem] lg:grid-cols-[18px_5.5rem_7.5rem_minmax(0,1fr)_minmax(8rem,14rem)_6.75rem_3.5rem]",
    "transition-colors",
    hasAction
      ? "cursor-pointer hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      : "cursor-default",
    item.active ? "bg-foreground/[0.05]" : "",
  );

  const inner = (
    <>
      <span className="inline-flex shrink-0 items-center justify-center">
        <SourceGlyph source={item.sourceKind} label={item.sourceLabel} />
      </span>

      {!suppressSourceLabel && (
        <MetadataCell
          className="hidden sm:flex"
          label={item.sourceLabel}
        />
      )}

      <MetadataCell
        className={suppressSourceLabel ? "hidden sm:flex" : "hidden md:flex"}
        label={targetLabel}
      />

      <span className="min-w-0" title={item.title}>
        <span className="block min-w-0 truncate text-sm font-medium leading-5 text-foreground">
          {item.title}
        </span>
        {subtitle ? (
          <span className="block min-w-0 truncate text-xs leading-4 text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>

      <MetadataCell
        className="hidden lg:flex"
        label={item.branchLabel ?? ""}
        subtle
      />

      <MetadataCell
        className="hidden justify-end lg:flex"
        label={item.statusLabel}
      />

      <span className="relative flex min-w-0 items-center justify-end text-right text-xs tabular-nums leading-4 text-muted-foreground">
        <span
          className={twMerge(
            "truncate transition-opacity",
            showExternalOpenAction ? "group-hover:opacity-0 group-focus-visible:opacity-0" : "",
          )}
        >
          {item.updatedLabel ?? ""}
        </span>
        {showExternalOpenAction && (
          <span
            className="pointer-events-none absolute right-0 flex size-7 items-center justify-center text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          >
            <ExternalLink className="size-3.5" />
          </span>
        )}
      </span>

      {!showExternalOpenAction && item.ownerLabel === "Unclaimed" && !suppressOwnerLabel && (
        <span className="pointer-events-none absolute right-16 hidden text-xs font-medium leading-4 text-foreground/0 transition-colors group-hover:text-foreground group-focus-visible:text-foreground xl:block">
          Claim
        </span>
      )}
    </>
  );

  if (!hasAction) {
    return (
      <div
        className={rowClass}
        aria-label={ariaLabel}
        aria-current={item.active ? "page" : undefined}
      >
        {inner}
      </div>
    );
  }

  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      onClick={() => onWorkspaceSelect(item.id)}
      className={rowClass}
      aria-current={item.active ? "page" : undefined}
      aria-label={ariaLabel}
    >
      {inner}
    </Button>
  );
}

function MetadataCell({
  className,
  label,
  subtle = false,
}: {
  className: string;
  label: string;
  subtle?: boolean;
}) {
  return (
    <span
      className={twMerge(
        "min-w-0 items-center gap-1.5 text-xs leading-4",
        subtle ? "text-muted-foreground/70" : "text-muted-foreground",
        className,
      )}
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function buildRowAriaLabel(
  item: WorkspaceInventoryItemView,
  opensExternally: boolean,
): string {
  return [
    item.title,
    item.repoLabel ? `repository ${item.repoLabel}` : null,
    item.branchLabel ? `branch ${item.branchLabel}` : null,
    item.sessionLabel ? `session ${item.sessionLabel}` : null,
    `source ${item.sourceLabel}`,
    item.scopeLabel ? `scope ${item.scopeLabel}` : null,
    `runtime ${item.runtimeLocationLabel}`,
    item.cloudAccessLabel ? item.cloudAccessLabel : null,
    item.commandabilityLabel ? item.commandabilityLabel : null,
    `status ${item.statusLabel}`,
    item.ownerLabel ? `owner ${item.ownerLabel}` : null,
    item.exposureLabel ? `exposure ${item.exposureLabel}` : null,
    item.updatedLabel ? `last updated ${item.updatedLabel}` : null,
    opensExternally ? "opens externally" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function rowSubtitle(item: WorkspaceInventoryItemView): string | null {
  return (
    [
      item.repoLabel,
      item.sessionLabel,
      item.commandabilityLabel,
    ].filter(Boolean).join(" · ") ||
    item.description ||
    null
  );
}
