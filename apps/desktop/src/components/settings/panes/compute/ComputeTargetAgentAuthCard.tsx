import { useNavigate } from "react-router-dom";
import { useRouteSelections } from "@proliferate/cloud-sdk-react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { DirectRuntimeAttachChip } from "@/components/compute/DirectRuntimeAttachChip";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useDirectRuntimeAttachState } from "@/hooks/compute/derived/use-direct-runtime-attach-states";
import { directRuntimeEditsDeferred } from "@/lib/domain/compute/direct-runtime-presentation";
import { countTargetOverrides } from "@/lib/domain/settings/agents-runtime-scope";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { getFirstHarnessSettingsSection } from "@/lib/domain/settings/navigation-presentation";

/**
 * Per-target agent-auth summary (settings-admin-ia.md §5.2): whether this
 * runtime inherits the user's default credential document or carries
 * per-runtime overrides, with the affordance into the Agents scope page for
 * this runtime. Editable while the runtime is offline — the push is deferred
 * to the next attach.
 */
export function ComputeTargetAgentAuthCard({ targetId }: { targetId: string }) {
  const navigate = useNavigate();
  const { cloudActive } = useCloudAvailabilityState();
  const attachState = useDirectRuntimeAttachState(targetId);
  const overridesQuery = useRouteSelections(cloudActive, { targetId });
  const overrideCount = countTargetOverrides(overridesQuery.data?.selections);

  return (
    <SettingsSection
      title={COMPUTE_COPY.agentAuthTitle}
      description={COMPUTE_COPY.agentAuthDescription}
    >
      <div className="space-y-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {overridesQuery.data === undefined ? (
            <span className="text-sm text-muted-foreground">
              {COMPUTE_COPY.agentAuthLoading}
            </span>
          ) : (
            <Badge tone={overrideCount === 0 ? "neutral" : "accent"}>
              {overrideCount === 0
                ? COMPUTE_COPY.agentAuthUsingDefaults
                : COMPUTE_COPY.agentAuthOverrideCount(overrideCount)}
            </Badge>
          )}
          <DirectRuntimeAttachChip state={attachState} />
        </div>
        {directRuntimeEditsDeferred(attachState) ? (
          <p className="text-xs text-muted-foreground">
            {COMPUTE_COPY.willApplyWhenAttached}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              navigate(
                buildSettingsHref({
                  section: getFirstHarnessSettingsSection(),
                  focus: { target: targetId },
                }),
              )
            }
          >
            {COMPUTE_COPY.agentAuthManage}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
