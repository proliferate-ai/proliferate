import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import type { SettingsAgentModelVisibilityRow } from "@/lib/domain/settings/agent-defaults";

interface ModelRegistryPaneProps {
  agentKind: string;
  models: SettingsAgentModelVisibilityRow[];
  refreshable: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onVisibilityChange: (modelId: string, visible: boolean) => void;
}

export function ModelRegistryPane({
  agentKind,
  models,
  refreshable,
  refreshing,
  onRefresh,
  onVisibilityChange,
}: ModelRegistryPaneProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) {
      return models;
    }
    return models.filter((model) => {
      const displayName = model.displayName.toLocaleLowerCase();
      const id = model.id.toLocaleLowerCase();
      return displayName.includes(normalizedQuery) || id.includes(normalizedQuery);
    });
  }, [models, normalizedQuery]);
  const visibleCount = models.filter((model) => model.isVisible).length;

  if (models.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Visible models</p>
          <p className="text-xs text-muted-foreground">
            {visibleCount}/{models.length} shown
          </p>
        </div>
        {refreshable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={refreshing}
            onClick={onRefresh}
          >
            Refresh
          </Button>
        ) : null}
      </div>
      <input
        aria-label={`Search ${agentKind} models`}
        className="mb-2 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
        placeholder="Search models"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {filteredModels.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">No models found</p>
        ) : filteredModels.map((model) => (
          <div
            key={model.id}
            className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted/50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{model.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {model.id}
                {model.hasManualOverride ? " · manual" : model.catalogDefaultOptIn ? " · default" : ""}
              </p>
            </div>
            <Switch
              aria-label={`Toggle ${model.displayName}`}
              checked={model.isVisible}
              onChange={(visible) => onVisibilityChange(model.id, visible)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
