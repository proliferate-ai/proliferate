import { AUTOMATION_PREEXECUTOR_COPY } from "@/config/automations";
import type { AutomationResponse } from "@/lib/integrations/cloud/client";
import { AutomationRow } from "./AutomationRow";

interface AutomationListContentProps {
  automations: AutomationResponse[];
  loading: boolean;
  busy: boolean;
  onSelect: (automationId: string) => void;
  onEdit: (automation: AutomationResponse) => void;
  onPause: (automationId: string) => void;
  onResume: (automationId: string) => void;
  onRunNow: (automationId: string) => void;
}

export function AutomationListContent({
  automations,
  loading,
  busy,
  onSelect,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: AutomationListContentProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-5 text-sm text-muted-foreground">
        Loading automations...
      </div>
    );
  }

  if (automations.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-5 text-sm text-muted-foreground">
        {AUTOMATION_PREEXECUTOR_COPY.emptyState}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      {automations.map((automation) => (
        <AutomationRow
          key={automation.id}
          automation={automation}
          selected={false}
          busy={busy}
          onSelect={() => onSelect(automation.id)}
          onEdit={() => onEdit(automation)}
          onPause={() => onPause(automation.id)}
          onResume={() => onResume(automation.id)}
          onRunNow={() => onRunNow(automation.id)}
        />
      ))}
    </div>
  );
}
