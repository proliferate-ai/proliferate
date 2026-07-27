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
  // While either one-shot query is still in flight (first load, not a
  // background refetch) there is no observation yet to call synced/failed —
  // rendering "Not ready" here would be a false warning, not a report.
  const isLoading = editor.capabilitiesQuery.isPending || editor.enrollmentQuery.isPending;
  const synced = !isLoading
    && Boolean(capabilities?.gatewayEnabled)
    && (enrollment === undefined || enrollment.syncStatus === "synced");
  const failed = !isLoading
    && (enrollment?.syncStatus === "failed" || capabilities?.gatewayEnabled === false);

  return (
    <HarnessStatusRow
      data-harness-status="gateway"
      label={isLoading
        ? HARNESS_PANE_COPY.runtimeChecking
        : synced
          ? HARNESS_PANE_COPY.gatewayAuthenticated
          : failed
            ? HARNESS_PANE_COPY.gatewayUnavailable
            : HARNESS_PANE_COPY.gatewayPending}
      tone={isLoading ? "neutral" : synced ? "success" : failed ? "destructive" : "warning"}
      // Saved fact (the enabled gateway selection) beside the live enrollment
      // observation, never instead of it.
      savedState={editor.editorState.gatewayEnabled
        ? HARNESS_PANE_COPY.gatewaySaved
        : null}
      description={isLoading ? null : gatewaySubtitle(capabilities, enrollment)}
      refreshing={editor.capabilitiesQuery.isFetching || editor.enrollmentQuery.isFetching}
      onRefresh={() => {
        void editor.capabilitiesQuery.refetch();
        void editor.enrollmentQuery.refetch();
      }}
    />
  );
}
