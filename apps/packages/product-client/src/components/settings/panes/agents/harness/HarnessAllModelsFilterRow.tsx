import { Search, X } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";

interface HarnessAllModelsFilterRowProps {
  filterText: string;
  filteredCount: number;
  totalCount: number;
  onChange: (value: string) => void;
  onClear: () => void;
}

/**
 * The All Models filter row (extracted from HarnessAllModelsSection to keep that
 * file under the frontend size threshold).
 *
 * Canonical picker-search treatment (PopoverSearchField recipe): muted magnifier
 * + borderless transparent input — no boxed field — with a hairline divider
 * between the row and the table below. py-[7px] matches PopoverSearchField's own
 * filter-row height exactly, so the two recipes stay pixel-identical rather than
 * drifting to the nearest space-scale step.
 */
export function HarnessAllModelsFilterRow({
  filterText,
  filteredCount,
  totalCount,
  onChange,
  onClear,
}: HarnessAllModelsFilterRowProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-2.5 py-[7px]">
      <Search className="icon-paired shrink-0 text-muted-foreground/75" />
      <Input
        aria-label="Filter models"
        placeholder="Filter models..."
        value={filterText}
        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-ui shadow-none focus:ring-0"
        onChange={(event) => onChange(event.target.value)}
      />
      {filterText ? (
        <span className="flex shrink-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
          {filteredCount} of {totalCount}
          <Button
            variant="unstyled"
            size="unstyled"
            type="button"
            aria-label="Clear filter"
            className="rounded p-0.5 hover:bg-hover active:bg-active"
            onClick={onClear}
          >
            <X className="icon-compact" />
          </Button>
        </span>
      ) : null}
    </div>
  );
}
