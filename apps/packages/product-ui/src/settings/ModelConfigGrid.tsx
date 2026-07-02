import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { GridTile } from "@proliferate/ui/primitives/GridTile";
import { Switch } from "@proliferate/ui/primitives/Switch";

export interface ModelConfigGridItem {
  id: string;
  name: ReactNode;
  provider: ReactNode;
  version?: ReactNode;
  enabled: boolean;
  disabled?: boolean;
}

export interface ModelConfigGridProps {
  models: readonly ModelConfigGridItem[];
  onToggle: (id: string, enabled: boolean) => void;
  className?: string;
}

/**
 * "All Models" catalog grid: flat bordered `GridTile`s (CONTRACT §1 — no cards),
 * one per model, each with name + provider `Badge`, optional version line, and an
 * Enabled `Switch` in a hairline-divided footer.
 */
export function ModelConfigGrid({ models, onToggle, className }: ModelConfigGridProps) {
  return (
    <div className={twMerge("grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3", className)}>
      {models.map((model) => (
        <GridTile key={model.id}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">
                {model.name}
              </span>
              <Badge tone="neutral">{model.provider}</Badge>
            </div>
            {model.version ? (
              <span className="text-[12px] leading-[1.45] text-muted-foreground">{model.version}</span>
            ) : null}
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2.5">
              <span className="text-[12px] font-medium leading-[1.45] text-muted-foreground">Enabled</span>
              <Switch
                checked={model.enabled}
                disabled={model.disabled}
                size="compact"
                onChange={(next) => onToggle(model.id, next)}
              />
            </div>
          </div>
        </GridTile>
      ))}
    </div>
  );
}
