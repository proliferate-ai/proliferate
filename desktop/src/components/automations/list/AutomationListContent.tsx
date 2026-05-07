import { AUTOMATION_PREEXECUTOR_COPY } from "@/copy/automations/automation-copy";
import type { AutomationResponse } from "@/lib/access/cloud/client";
import { AutomationRow } from "./AutomationRow";
import { AutomationSectionHeader } from "./AutomationSectionHeader";

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
      <section className="flex flex-col gap-2">
        <AutomationSectionHeader title="Current" />
        <div className="-mx-3 rounded-lg px-3 py-6 text-sm text-muted-foreground">
          Loading automations...
        </div>
      </section>
    );
  }

  if (automations.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <AutomationSectionHeader title="Current" />
        <div className="-mx-3 rounded-lg px-3 py-8">
          <div className="text-sm font-medium text-foreground">No automations yet</div>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            {AUTOMATION_PREEXECUTOR_COPY.emptyState}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <AutomationSectionHeader title="Current" count={automations.length} />
      <div className="-mx-3 flex flex-col gap-1" role="list">
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
    </section>
  );
}
