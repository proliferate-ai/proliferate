import { Server } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { COMPUTE_COPY } from "@/copy/settings/compute";

export function ComputeTargetEmptyState() {
  return (
    <SettingsCard className="min-h-[320px]">
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="inline-flex size-11 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
          <Server className="size-5" aria-hidden="true" />
        </span>
        <div className="max-w-sm space-y-2">
          <h3 className="text-sm font-medium text-foreground">{COMPUTE_COPY.selectTargetTitle}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {COMPUTE_COPY.selectTargetDescription}
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}
