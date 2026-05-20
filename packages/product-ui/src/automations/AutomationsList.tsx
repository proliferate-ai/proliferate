import { CalendarClock, Plus } from "lucide-react";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { ListSurface } from "@proliferate/ui/layout/ListSurface";
import { Button } from "@proliferate/ui/primitives/Button";
import { AutomationRow } from "./AutomationRow";

export interface AutomationListItemView {
  id: string;
  title: string;
  repo: string;
  schedule: string;
  target: string;
  lastRun?: string | null;
  enabled: boolean;
}

interface AutomationsListProps {
  items: AutomationListItemView[];
  loading?: boolean;
  error?: boolean;
  onNew?: () => void;
}

export function AutomationsList({
  items,
  loading = false,
  error = false,
  onNew,
}: AutomationsListProps) {
  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={onNew}>
          <Plus size={13} />
          New
        </Button>
      </div>
      {loading ? (
        <ListSurface>
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            Loading automations...
          </div>
        </ListSurface>
      ) : error ? (
        <EmptyState
          title="Could not load automations"
          description="Refresh the page or sign in again."
        />
      ) : items.length > 0 ? (
        <ListSurface>
          {items.map((automation) => (
            <AutomationRow
              key={automation.id}
              name={automation.title}
              description={(
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <CalendarClock size={11.5} className="shrink-0" />
                  <span className="truncate">{automation.schedule}</span>
                  <span className="text-muted-foreground/40">-</span>
                  <span className="truncate">{automation.repo}</span>
                </span>
              )}
              runSummary={automation.lastRun ? `Ran ${automation.lastRun}` : "Not scheduled yet"}
              statusLabel={automation.enabled ? "On" : "Paused"}
              statusTone={automation.enabled ? "success" : "neutral"}
            />
          ))}
        </ListSurface>
      ) : (
        <EmptyState
          title="No automations yet"
          description="Create automations from Desktop while this surface is being wired."
        />
      )}
    </>
  );
}
