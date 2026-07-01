import { Server } from "@proliferate/ui/icons";
import { COMPUTE_COPY } from "@/copy/settings/compute";

export function ComputeTargetEmptyState() {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="mb-1 flex items-center justify-center text-muted-foreground [&>svg]:size-[22px]">
        <Server aria-hidden="true" />
      </div>
      <div className="text-sm font-medium text-foreground">{COMPUTE_COPY.selectTargetTitle}</div>
      <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">
        {COMPUTE_COPY.selectTargetDescription}
      </p>
    </div>
  );
}
