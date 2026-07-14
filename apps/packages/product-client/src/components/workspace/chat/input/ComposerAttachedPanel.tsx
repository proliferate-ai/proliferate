import { type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown } from "@proliferate/ui/icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

interface ComposerAttachedPanelProps {
  /** Optional 16px leading icon for the structured header. */
  icon?: ReactNode;
  /**
   * Structured header title (text-ui medium). When set, the panel renders
   * the shared interaction-card header grammar; `header` is ignored.
   */
  title?: ReactNode;
  /**
   * Optional trailing context line (text-ui-sm muted) — server name, wizard
   * progress, and similar meta.
   */
  context?: ReactNode;
  /** Escape hatch: fully custom header content (status panels, todo tracker). */
  header?: ReactNode;
  children?: ReactNode;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /**
   * Make the whole header row a collapse/expand pointer target (the chevron
   * button stays the accessible control). Progress-style panels opt in so a
   * click anywhere on the header folds the list down to just the header.
   */
  toggleOnHeaderClick?: boolean;
}

export function ComposerAttachedPanel({
  icon,
  title,
  context,
  header,
  children,
  expanded = true,
  onToggleExpanded,
  toggleOnHeaderClick = false,
}: ComposerAttachedPanelProps) {
  // Attached-panel shell (UX_SPEC §5): 13px radius (top — the bottom edge
  // docks into the composer), 0.5px border, 2% foreground tint. No backdrop
  // blur: the dock bans blur over the transcript (see the PERF note in
  // ChatComposerDock) and the panel sits on that same stack.
  //
  // Header grammar shared by every interaction card: optional 16px leading
  // icon + text-ui medium title + optional text-ui-sm muted context line.
  const headerContent = title != null
    ? (
      <>
        {icon && (
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
          {title}
        </span>
        {context != null && (
          <span className="shrink-0 text-ui-sm text-muted-foreground">
            {context}
          </span>
        )}
      </>
    )
    : header;
  const headerClickToggles = toggleOnHeaderClick && onToggleExpanded != null;
  return (
    <div className="relative overflow-clip rounded-t-[13px] border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))] transition-colors">
      {headerContent && (
        <div
          className={twMerge(
            "flex w-full items-start justify-between gap-1.5 py-3 pr-2 pl-3 text-chat leading-[var(--text-chat--line-height)]",
            headerClickToggles && "cursor-pointer select-none",
          )}
          onClick={headerClickToggles ? onToggleExpanded : undefined}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {headerContent}
          </div>
          {onToggleExpanded && (
            <div className="flex min-w-fit shrink-0 items-center gap-1.5 select-none">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={(event) => {
                  // Keep the chevron a single toggle when the header row is
                  // itself a click target.
                  event.stopPropagation();
                  onToggleExpanded();
                }}
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                aria-label={expanded ? "Collapse panel" : "Expand panel"}
              >
                <ChevronDown
                  className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
                />
              </Button>
            </div>
          )}
        </div>
      )}
      {expanded && children && (
        <div className="overflow-visible">
          {children}
        </div>
      )}
    </div>
  );
}

export interface ComposerCardAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

const FOOTER_CHIP_BASE_CLASSNAME =
  "rounded-md px-3 py-1 text-ui-sm font-medium transition-colors disabled:cursor-default disabled:opacity-60";

/**
 * The single interaction-card footer grammar: secondary chip actions on the
 * left, one primary action chip on the right. Every composer-docked card
 * (user input wizard, MCP elicitation form/url) renders its footer through
 * this so the three cards keep one anatomy.
 */
export function ComposerCardFooter({
  secondaryActions = [],
  primaryAction,
}: {
  secondaryActions?: ComposerCardAction[];
  primaryAction?: ComposerCardAction;
}) {
  if (secondaryActions.length === 0 && !primaryAction) {
    return null;
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {secondaryActions.map((action) => (
          <Button
            key={action.label}
            type="button"
            variant="unstyled"
            size="unstyled"
            disabled={action.disabled}
            onClick={action.onSelect}
            className={twMerge(
              FOOTER_CHIP_BASE_CLASSNAME,
              "border border-input text-muted-foreground hover:border-border-heavy hover:text-foreground",
            )}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {primaryAction && (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          disabled={primaryAction.disabled}
          onClick={primaryAction.onSelect}
          className={twMerge(
            FOOTER_CHIP_BASE_CLASSNAME,
            "border border-transparent bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          {primaryAction.label}
        </Button>
      )}
    </div>
  );
}
