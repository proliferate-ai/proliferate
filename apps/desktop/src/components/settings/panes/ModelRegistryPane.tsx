import { useId, useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown } from "@proliferate/ui/icons";
import { Input } from "@proliferate/ui/primitives/Input";
import { Switch } from "@proliferate/ui/primitives/Switch";
import type { SettingsAgentModelVisibilityRow } from "@/lib/domain/settings/agent-defaults";

interface ModelRegistryPaneProps {
  agentKind: string;
  models: SettingsAgentModelVisibilityRow[];
  refreshable: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onVisibilityChange: (
    modelId: string,
    visible: boolean,
    catalogDefaultOptIn: boolean,
  ) => void;
}

export function ModelRegistryPane({
  agentKind,
  models,
  refreshable,
  refreshing,
  onRefresh,
  onVisibilityChange,
}: ModelRegistryPaneProps) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
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
    <div className="px-1 py-1">
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-expanded={expanded}
          aria-controls={listId}
          className="group flex min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md px-1.5 py-1 text-left text-muted-foreground hover:bg-muted/35 hover:text-foreground/80"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            className={`size-3 shrink-0 text-foreground-tertiary transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-ui-sm font-medium">Visible models</span>
            <span className="shrink-0 text-ui-sm text-foreground-tertiary">
              {visibleCount}/{models.length} shown
            </span>
          </span>
        </Button>
        {refreshable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={refreshing}
            className="h-7 text-xs text-muted-foreground"
            onClick={onRefresh}
          >
            Refresh
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <div id={listId} className="pl-5 pt-1.5">
          <Input
            aria-label={`Search ${agentKind} models`}
            className="mb-2 h-8 px-2"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {filteredModels.length === 0 ? (
              <p className="px-2 py-3 text-ui-sm text-muted-foreground">No models found</p>
            ) : filteredModels.map((model) => (
              <div
                key={model.id}
                className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-ui text-foreground">{model.displayName}</p>
                  <p className="truncate text-ui-sm text-muted-foreground">
                    {model.id}
                    {model.hasManualOverride ? " · manual" : model.catalogDefaultOptIn ? " · default" : ""}
                  </p>
                </div>
                <Switch
                  aria-label={`Toggle ${model.displayName}`}
                  checked={model.isVisible}
                  disabled={model.isVisible && !model.canHide}
                  title={model.isVisible && !model.canHide
                    ? "At least one model must stay visible"
                    : undefined}
                  onChange={(visible) =>
                    onVisibilityChange(model.id, visible, model.catalogDefaultOptIn)
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
