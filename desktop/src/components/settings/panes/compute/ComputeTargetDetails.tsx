import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import {
  computeTargetKindLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
} from "@/lib/domain/compute/target-presentation";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";
import { ComputeTargetReadiness } from "./ComputeTargetReadiness";

interface ComputeTargetDetailsProps {
  target: ComputeTargetDetail | ComputeTargetSummary | null;
  loading: boolean;
  onArchive: (targetId: string) => void;
  archiving: boolean;
}

export function ComputeTargetDetails({
  target,
  loading,
  onArchive,
  archiving,
}: ComputeTargetDetailsProps) {
  if (loading) {
    return (
      <SettingsCard>
        <div className="p-3 text-sm text-muted-foreground">Loading target details...</div>
      </SettingsCard>
    );
  }
  if (!target) {
    return (
      <SettingsCard>
        <div className="p-3 text-sm text-muted-foreground">
          Select a compute target to view its worker, inventory, and readiness.
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <div className="space-y-4 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-foreground">{target.displayName}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {computeTargetKindLabel(target.kind)}
              {target.inventory?.os ? ` · ${target.inventory.os}/${target.inventory.arch ?? "unknown"}` : ""}
            </p>
          </div>
          <Badge tone={computeTargetStatusTone(target.status)}>
            {computeTargetStatusLabel(target.status)}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Workspace root</dt>
            <dd className="mt-1 truncate text-foreground">{target.defaultWorkspaceRoot ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last heartbeat</dt>
            <dd className="mt-1 truncate text-foreground">
              {target.statusDetail?.lastHeartbeatAt ?? "Not seen yet"}
            </dd>
          </div>
        </dl>

        <ComputeTargetReadiness inventory={target.inventory} />

        {target.status !== "archived" && (
          <div className="flex justify-end border-t border-border/40 pt-3">
            <Button
              type="button"
              variant="outline"
              loading={archiving}
              onClick={() => {
                if (window.confirm(COMPUTE_COPY.archiveConfirm)) {
                  onArchive(target.id);
                }
              }}
            >
              Archive target
            </Button>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
