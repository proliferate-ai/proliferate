import { Button } from "@/components/ui/Button";
import { ArrowLeft } from "@/components/ui/icons";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "@/lib/access/cloud/client";
import { AutomationRunTimeline } from "@/components/automations/timeline/AutomationRunTimeline";
import { AutomationSectionHeader } from "./AutomationSectionHeader";

interface AutomationDetailContentProps {
  automation: AutomationResponse | null;
  loading: boolean;
  error: boolean;
  runs: AutomationRunResponse[];
  runsLoading: boolean;
  pendingCloudWorkspaceId?: string | null;
  onBack: () => void;
  onOpenCloudWorkspace: (cloudWorkspaceId: string) => void;
  onOpenLocalWorkspace: (run: AutomationRunResponse) => void;
}

export function AutomationDetailContent({
  automation,
  loading,
  error,
  runs,
  runsLoading,
  pendingCloudWorkspaceId = null,
  onBack,
  onOpenCloudWorkspace,
  onOpenLocalWorkspace,
}: AutomationDetailContentProps) {
  if (loading) {
    return (
      <section className="flex flex-col gap-2">
        <AutomationSectionHeader title="Automation" />
        <div className="-mx-3 rounded-lg px-3 py-6 text-sm text-muted-foreground">
          Loading automation...
        </div>
      </section>
    );
  }

  if (error || !automation) {
    return (
      <section className="flex flex-col gap-2">
        <AutomationSectionHeader title="Automation" />
        <div className="-mx-3 rounded-lg px-3 py-8">
          <p className="text-sm font-medium text-foreground">Automation not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted or you may not have access to it.
          </p>
          <Button variant="ghost" size="sm" onClick={onBack} className="mt-4 -ml-2">
            <ArrowLeft className="size-4" />
            Back to automations
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section className="flex min-w-0 flex-col gap-2">
        <AutomationSectionHeader title="Run history" count={runs.length} />
        <AutomationRunTimeline
          runs={runs}
          loading={runsLoading}
          pendingCloudWorkspaceId={pendingCloudWorkspaceId}
          onOpenCloudWorkspace={onOpenCloudWorkspace}
          onOpenLocalWorkspace={onOpenLocalWorkspace}
        />
      </section>
    </div>
  );
}
