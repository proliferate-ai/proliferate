import { gatewaySubtitle } from "#product/copy/settings/agent-auth-copy";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { HarnessStatusRow } from "#product/components/settings/panes/agents/harness/HarnessStatusRow";

/**
 * Gateway authenticated-status, on the SAME status row as native and api_key
 * (§3: "am I authenticated" is one question with one answer shape). The refresh
 * affordance re-reads enrollment/capabilities — the same two queries that
 * decide whether the gateway can serve at all.
 */
export function GatewayDetails({ editor }: { editor: HarnessAuthEditorApi }) {
  const capabilities = editor.capabilitiesQuery.data;
  const enrollment = editor.enrollmentQuery.data;
  const synced = Boolean(capabilities?.gatewayEnabled)
    && (enrollment === undefined || enrollment.syncStatus === "synced");
  const failed = enrollment?.syncStatus === "failed"
    || capabilities?.gatewayEnabled === false;

  return (
    <HarnessStatusRow
      data-harness-status="gateway"
      label={synced
        ? HARNESS_PANE_COPY.gatewayAuthenticated
        : failed
          ? HARNESS_PANE_COPY.gatewayUnavailable
          : HARNESS_PANE_COPY.gatewayPending}
      tone={synced ? "success" : failed ? "destructive" : "warning"}
      // Saved fact (the enabled gateway selection) beside the live enrollment
      // observation, never instead of it.
      savedState={editor.editorState.gatewayEnabled
        ? HARNESS_PANE_COPY.gatewaySaved
        : null}
      description={gatewaySubtitle(capabilities, enrollment)}
      refreshing={editor.capabilitiesQuery.isFetching || editor.enrollmentQuery.isFetching}
      onRefresh={() => {
        void editor.capabilitiesQuery.refetch();
        void editor.enrollmentQuery.refetch();
      }}
    />
  );
}
