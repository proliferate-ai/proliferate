import { gatewaySubtitle } from "@/copy/settings/agent-auth-copy";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "@/hooks/agents/workflows/use-harness-auth-editor";
import { HarnessPanelBlock, type HarnessBlockVariant } from "./HarnessPanelBlock";

export function GatewayDetails({
  editor,
  variant,
}: {
  editor: HarnessAuthEditorApi;
  variant: HarnessBlockVariant;
}) {
  const capabilities = editor.capabilitiesQuery.data;
  const enrollment = editor.enrollmentQuery.data;
  return (
    <HarnessPanelBlock variant={variant} title={HARNESS_PANE_COPY.detailsGateway}>
      <p className="py-3 text-sm text-muted-foreground">
        {gatewaySubtitle(capabilities, enrollment)}
      </p>
    </HarnessPanelBlock>
  );
}
