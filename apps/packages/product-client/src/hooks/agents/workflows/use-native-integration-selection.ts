import { useCallback } from "react";
import { useNativeIntegrationSelectionMutation } from "#product/hooks/access/anyharness/agents/use-native-integrations-query";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { useToastStore } from "#product/stores/toast/toast-store";

/**
 * The user action of the native-integrations settings section: flip one
 * selection on or off. The wire write and cache write-back live in the
 * access layer (`use-native-integrations-query`); this hook adds the
 * user-facing failure report — a toast naming the integration by its human
 * name, never the raw id. Owner spec:
 * `specs/systems/harnesses/native-integrations.md`.
 */
export function useNativeIntegrationSelection(harnessKind: string) {
  const mutation = useNativeIntegrationSelectionMutation(harnessKind);
  const showToast = useToastStore((state) => state.show);

  const setEnabled = useCallback(
    (
      input: { integrationId: string; enabled: boolean; displayName: string },
      callbacks?: { onSettled?: () => void },
    ) => {
      mutation.mutate(
        { integrationId: input.integrationId, enabled: input.enabled },
        {
          onError: () => {
            showToast(HARNESS_PANE_COPY.nativeIntegrationsUpdateError(input.displayName));
          },
          onSettled: callbacks?.onSettled,
        },
      );
    },
    [mutation, showToast],
  );

  return { setEnabled, isPending: mutation.isPending };
}
