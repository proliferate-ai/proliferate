import { Badge } from "@proliferate/ui/primitives/Badge";
import { Check, RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import {
  computeTargetKindLabel,
  computeTargetOwnerLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
} from "@/lib/domain/compute/target-presentation";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";
import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";

export function ComputeTargetDetailsHeader({
  target,
  appearance,
  canReconnect,
  canTestConnection,
  reconnecting,
  testing,
  reconnectTitle,
  onReconnect,
  onTestConnection,
  onSave,
}: {
  target: ComputeTargetDetail | ComputeTargetSummary;
  appearance: ComputeTargetAppearance;
  canReconnect: boolean;
  canTestConnection: boolean;
  reconnecting: boolean;
  testing: boolean;
  reconnectTitle?: string;
  onReconnect: () => void;
  onTestConnection: () => void;
  onSave: () => void;
}) {
  return (
    <div className="border-b border-border/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ComputeTargetSwatch appearance={appearance} size="sm" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-foreground">
              {appearance.displayName}
            </h3>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {computeTargetKindLabel(target.kind)}
              {" · "}
              {computeTargetOwnerLabel(target.ownerScope)}
              {target.statusDetail?.lastHeartbeatAt
                ? ` · last heartbeat ${target.statusDetail.lastHeartbeatAt}`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={computeTargetStatusTone(target.status)}>
            {computeTargetStatusLabel(target.status)}
          </Badge>
          {target.kind === "ssh" && (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={!canReconnect}
                loading={reconnecting}
                onClick={onReconnect}
                title={reconnectTitle}
              >
                <RefreshCw className="size-3.5" />
                {COMPUTE_COPY.reconnectTarget}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!canTestConnection}
                loading={testing}
                onClick={onTestConnection}
              >
                <RefreshCw className="size-3.5" />
                {COMPUTE_COPY.testConnection}
              </Button>
            </>
          )}
          <Button type="button" onClick={onSave}>
            <Check className="size-3.5" />
            {COMPUTE_COPY.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
